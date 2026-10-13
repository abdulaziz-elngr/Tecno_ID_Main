import { type NextRequest } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { getAuthContext, UnauthorizedError } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { UploadValidationError, validateUpload } from "@/lib/upload";
import { storeObject } from "@/lib/storage";
import { writeAuditLog } from "@/lib/audit";
import { BusinessRuleError, created, handleApiError } from "@/lib/api";

const SCOPE = "files.upload";

/**
 * File uploads go through the storage abstraction in src/lib/storage.ts,
 * which writes to S3-compatible object storage (STORAGE_PROVIDER=s3,
 * required in production on Vercel) or local disk (STORAGE_PROVIDER=local,
 * dev only). The public URL always stays behind the authenticated
 * /api/files/[...key] proxy (§62 — student data is never on a public
 * URL), never a direct S3 link, whichever provider is active.
 */
const PUBLIC_PREFIX = process.env.STORAGE_PUBLIC_PREFIX || "/api/files";

export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();

    const limit = checkRateLimit(`upload:${ctx.userId}`, 30, 60 * 1000);
    if (!limit.allowed) {
      throw new BusinessRuleError("Too many uploads. Please slow down.", { status: 429 });
    }

    const form = await request.formData();
    const file = form.get("file");
    const kindRaw = String(form.get("kind") ?? "image");

    if (!(file instanceof File)) {
      throw new BusinessRuleError("No file was provided.", { status: 400 });
    }
    if (kindRaw !== "image" && kindRaw !== "document") {
      throw new BusinessRuleError("Unsupported upload kind.", { status: 400 });
    }

    const buffer = new Uint8Array(await file.arrayBuffer());

    const validated = validateUpload({
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: buffer.byteLength,
      head: buffer.subarray(0, 16),
      kind: kindRaw
    });

    const url = `${PUBLIC_PREFIX}/${validated.storageKey}`;
    await storeObject(validated.storageKey, buffer, validated.mimeType);
    const checksum = createHash("sha256").update(buffer).digest("hex");

    const asset = await db.fileAsset.create({
      data: {
        organizationId: ctx.organizationId,
        storageKey: validated.storageKey,
        url,
        originalName: validated.safeName,
        mimeType: validated.mimeType,
        sizeBytes: buffer.byteLength,
        checksum,
        uploadedById: ctx.userId
      }
    });

    await writeAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "UPLOAD_FILE",
      entityType: "FileAsset",
      entityId: asset.id,
      afterValue: { originalName: asset.originalName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes }
    });

    return created({ id: asset.id, url: asset.url, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes });
  } catch (err) {
    if (err instanceof UploadValidationError) {
      return handleApiError(SCOPE, new BusinessRuleError(err.message, { status: 400 }));
    }
    return handleApiError(SCOPE, err);
  }
}
