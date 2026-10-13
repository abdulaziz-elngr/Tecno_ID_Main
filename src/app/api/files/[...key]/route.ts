import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext, UnauthorizedError } from "@/lib/rbac";
import { readObject } from "@/lib/storage";
import { NotFoundError, handleApiError } from "@/lib/api";

const SCOPE = "files.serve";

/**
 * Authenticated file delivery (§62 — student data is never on a public URL).
 * The asset row also scopes the file to the caller's organization, so a
 * leaked key from another tenant is useless. readObject() transparently
 * reads from S3 or local disk depending on STORAGE_PROVIDER.
 */
export async function GET(_request: NextRequest, { params }: { params: { key: string[] } }) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) throw new UnauthorizedError();

    const storageKey = params.key.join("/");
    const asset = await db.fileAsset.findFirst({
      where: { storageKey, organizationId: ctx.organizationId }
    });
    if (!asset) throw new NotFoundError("File not found.");

    const bytes = await readObject(asset.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(asset.sizeBytes),
        "Content-Disposition": `inline; filename="${asset.originalName}"`,
        "Cache-Control": "private, max-age=0, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (err) {
    return handleApiError(SCOPE, err);
  }
}
