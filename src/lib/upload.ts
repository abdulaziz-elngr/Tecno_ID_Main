import { randomUUID } from "crypto";
import path from "path";

/**
 * File upload validation (spec §46).
 *
 * Three independent checks, because any one of them alone is bypassable:
 *   1. Declared MIME type is on the allow-list.
 *   2. Extension is on the allow-list AND matches that MIME type.
 *   3. The actual leading bytes (magic number) match the claimed type —
 *      a .png that really starts with "<?php" is rejected.
 *
 * Stored filenames are always regenerated (UUID + safe extension), so a
 * crafted name like "../../.env" or "shell.php.png" can never affect the
 * storage path.
 */

export const ALLOWED_IMAGE_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"]
};

export const ALLOWED_DOCUMENT_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"]
};

export const MAX_IMAGE_BYTES = Number(process.env.MAX_UPLOAD_IMAGE_BYTES || 3 * 1024 * 1024);
// Default 4 MB: Vercel serverless functions reject request/response bodies
// above ~4.5 MB, and uploads and downloads both pass through a function.
export const MAX_DOCUMENT_BYTES = Number(process.env.MAX_UPLOAD_DOC_BYTES || 4 * 1024 * 1024);

const MAGIC_NUMBERS: { type: string; bytes: number[]; offset?: number }[] = [
  { type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { type: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: "image/webp", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { type: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }
];

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export function detectSignature(buffer: Uint8Array): string | null {
  for (const magic of MAGIC_NUMBERS) {
    const offset = magic.offset ?? 0;
    if (buffer.length < offset + magic.bytes.length) continue;
    const matches = magic.bytes.every((b, i) => buffer[offset + i] === b);
    if (matches) return magic.type;
  }
  return null;
}

export interface ValidateFileParams {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  head: Uint8Array;
  kind: "image" | "document";
}

export interface ValidatedFile {
  storageKey: string;
  safeName: string;
  mimeType: string;
  extension: string;
}

export function validateUpload(params: ValidateFileParams): ValidatedFile {
  const allowed = params.kind === "image" ? ALLOWED_IMAGE_TYPES : ALLOWED_DOCUMENT_TYPES;
  const maxBytes = params.kind === "image" ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;

  if (params.sizeBytes <= 0) throw new UploadValidationError("The file is empty.");
  if (params.sizeBytes > maxBytes) {
    throw new UploadValidationError(
      `File is too large. Maximum allowed size is ${Math.round(maxBytes / 1024 / 1024)} MB.`
    );
  }

  const extensions = allowed[params.mimeType];
  if (!extensions) throw new UploadValidationError("This file type is not allowed.");

  // Only the basename is ever considered — defeats path traversal.
  const base = path.basename(params.originalName).toLowerCase();
  const extension = path.extname(base);
  if (!extensions.includes(extension)) {
    throw new UploadValidationError("The file extension does not match its type.");
  }

  const signature = detectSignature(params.head);
  if (signature !== params.mimeType) {
    throw new UploadValidationError("The file content does not match its declared type.");
  }

  const safeExtension = extensions[0] ?? extension;
  return {
    storageKey: `${new Date().toISOString().slice(0, 7)}/${randomUUID()}${safeExtension}`,
    safeName: base.replace(/[^a-z0-9._-]/g, "_").slice(0, 120),
    mimeType: params.mimeType,
    extension: safeExtension
  };
}
