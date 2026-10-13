import { mkdir, readFile as fsReadFile, writeFile } from "fs/promises";
import path from "path";
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

function provider(): "s3" | "local" {
  const raw = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  if (raw === "s3") return "s3";
  return "local";
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
  if (provider() === "s3") {
    const response = await s3Client().send(
      new GetObjectCommand({ Bucket: bucketName(), Key: storageKey })
    );
    if (!response.Body) throw new StorageError("Empty object body.");
    return streamToBytes(response.Body);
  }

  return new Uint8Array(await fsReadFile(localTarget(storageKey)));
}
