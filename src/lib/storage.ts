import { mkdir, readFile as fsReadFile, writeFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  type S3ClientConfig
} from "@aws-sdk/client-s3";

/**
 * Storage driver abstraction (spec §46 / production checklist §11).
 *
 * STORAGE_PROVIDER selects the backend:
 *   - "s3"    — any S3-compatible object storage (AWS S3, DigitalOcean
 *               Spaces, MinIO, Cloudflare R2, ...). Required in
 *               production on Vercel, whose function filesystem is
 *               read-only/ephemeral outside of /tmp and never persists
 *               uploads across invocations or deployments.
 *   - "cloudinary" — Cloudinary (raw resource type, signed uploads).
 *               Needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and
 *               CLOUDINARY_API_SECRET. Files are only ever served to the
 *               browser through the authenticated /api/files proxy.
 *   - "local" — writes to STORAGE_LOCAL_DIR on disk. Fine for local
 *               development; must NOT be used in a Vercel production
 *               deployment.
 *
 * Nothing outside this module (and the two /api/files routes) needs to
 * know which backend is active — both storeObject/readObject take and
 * return plain bytes so callers are unaffected either way.
 */

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

function provider(): "s3" | "cloudinary" | "local" {
  const raw = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  if (raw === "s3") return "s3";
  if (raw === "cloudinary") return "cloudinary";
  return "local";
}

// ---------------------------------------------------------------------
// Cloudinary driver (no SDK needed: signed REST upload + plain fetch)
// ---------------------------------------------------------------------

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new StorageError(
      "STORAGE_PROVIDER=cloudinary requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to be set."
    );
  }
  const folder = (process.env.CLOUDINARY_FOLDER || "tecnoid").replace(/^\/+|\/+$/g, "");
  return { cloudName, apiKey, apiSecret, folder };
}

function cloudinaryPublicId(storageKey: string, folder: string): string {
  // storageKey is server-generated ("YYYY-MM/<uuid>.<ext>"); still refuse
  // anything that could escape the folder.
  if (storageKey.includes("..") || storageKey.startsWith("/")) {
    throw new StorageError("Invalid storage path.");
  }
  return folder ? `${folder}/${storageKey}` : storageKey;
}

async function cloudinaryStore(storageKey: string, bytes: Uint8Array): Promise<void> {
  const { cloudName, apiKey, apiSecret, folder } = cloudinaryConfig();
  const publicId = cloudinaryPublicId(storageKey, folder);
  const timestamp = String(Math.floor(Date.now() / 1000));

  // Signature = sha1("public_id=...&timestamp=..." + api_secret), params sorted.
  const signature = createHash("sha1")
    .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
    .digest("hex");

  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart]), storageKey.split("/").pop() || "file");
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("public_id", publicId);
  form.append("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    let detail = "";
    try {
      const data = (await response.json()) as { error?: { message?: string } };
      detail = data?.error?.message ? `: ${data.error.message}` : "";
    } catch {
      /* ignore body parse errors */
    }
    throw new StorageError(`Cloudinary upload failed (${response.status})${detail}`);
  }
}

async function cloudinaryRead(storageKey: string): Promise<Uint8Array> {
  const { cloudName, folder } = cloudinaryConfig();
  const publicId = cloudinaryPublicId(storageKey, folder);
  const response = await fetch(
    `https://res.cloudinary.com/${cloudName}/raw/upload/${publicId}`,
    { cache: "no-store" }
  );
  if (!response.ok) {
    throw new StorageError(`Cloudinary read failed (${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// Resolved to an absolute, normalized path so a relative STORAGE_LOCAL_DIR
// such as "./storage/uploads" (as in .env.example) works with the
// containment check below.
const LOCAL_DIR = path.resolve(process.env.STORAGE_LOCAL_DIR || path.join(process.cwd(), "storage", "uploads"));

function localTarget(storageKey: string): string {
  const target = path.resolve(LOCAL_DIR, storageKey);
  if (target !== LOCAL_DIR && !target.startsWith(LOCAL_DIR + path.sep)) {
    throw new StorageError("Invalid storage path.");
  }
  return target;
}

let cachedClient: S3Client | null = null;

function s3Client(): S3Client {
  if (cachedClient) return cachedClient;

  const region = process.env.STORAGE_REGION;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new StorageError(
      "STORAGE_PROVIDER=s3 requires STORAGE_REGION, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY to be set."
    );
  }

  const config: S3ClientConfig = {
    region,
    credentials: { accessKeyId, secretAccessKey }
  };
  // Only set for S3-compatible providers that aren't AWS itself
  // (MinIO, DigitalOcean Spaces, R2, ...); leave unset for real AWS S3.
  const endpoint = process.env.STORAGE_ENDPOINT;
  if (endpoint) {
    config.endpoint = endpoint;
    config.forcePathStyle = true;
  }

  cachedClient = new S3Client(config);
  return cachedClient;
}

function bucketName(): string {
  const bucket = process.env.STORAGE_BUCKET;
  if (!bucket) throw new StorageError("STORAGE_PROVIDER=s3 requires STORAGE_BUCKET to be set.");
  return bucket;
}

async function streamToBytes(body: unknown): Promise<Uint8Array> {
  // AWS SDK v3's GetObjectCommand response body is a Node Readable stream
  // in this runtime; buffer it fully (uploads are already capped at a
  // few MB by src/lib/upload.ts, so buffering in-memory is fine).
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Writes bytes under `storageKey`. storageKey is always generated
 * server-side (see src/lib/upload.ts) — never derived from user input —
 * but local-disk containment is re-asserted here as defence in depth.
 */
export async function storeObject(
  storageKey: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  if (provider() === "cloudinary") {
    await cloudinaryStore(storageKey, bytes);
    return;
  }

  if (provider() === "s3") {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: bucketName(),
        Key: storageKey,
        Body: bytes,
        ContentType: contentType
      })
    );
    return;
  }

  const target = localTarget(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

/** Reads back the bytes previously written under `storageKey`. */
export async function readObject(storageKey: string): Promise<Uint8Array> {
  if (provider() === "cloudinary") {
    return cloudinaryRead(storageKey);
  }

  if (provider() === "s3") {
    const response = await s3Client().send(
      new GetObjectCommand({ Bucket: bucketName(), Key: storageKey })
    );
    if (!response.Body) throw new StorageError("Empty object body.");
    return streamToBytes(response.Body);
  }

  return new Uint8Array(await fsReadFile(localTarget(storageKey)));
}
