import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import http from "http";
import os from "os";
import path from "path";
import { mkdtemp, rm } from "fs/promises";
import type { AddressInfo } from "net";

const ENV_KEYS = [
  "STORAGE_PROVIDER",
  "STORAGE_LOCAL_DIR",
  "STORAGE_BUCKET",
  "STORAGE_REGION",
  "STORAGE_ENDPOINT",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY"
] as const;

const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

async function loadStorage() {
  vi.resetModules();
  return import("./storage");
}

describe("storage: local provider (development)", () => {
  let dir: string;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("round-trips bytes and honours a relative STORAGE_LOCAL_DIR", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tecnoid-storage-"));
    process.env.STORAGE_PROVIDER = "local";
    // A relative path, exactly like ./storage/uploads in .env.example.
    process.env.STORAGE_LOCAL_DIR = path.relative(process.cwd(), dir);
    const { storeObject, readObject } = await loadStorage();

    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await storeObject("2026-09/abc.png", bytes, "image/png");
    expect(Array.from(await readObject("2026-09/abc.png"))).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects keys that escape the storage directory", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tecnoid-storage-"));
    process.env.STORAGE_PROVIDER = "local";
    process.env.STORAGE_LOCAL_DIR = dir;
    const { storeObject, readObject } = await loadStorage();

    await expect(storeObject("../evil.txt", new Uint8Array([1]), "text/plain")).rejects.toThrow(/Invalid storage path/);
    await expect(readObject("../../etc/passwd")).rejects.toThrow(/Invalid storage path/);
  });
});

describe("storage: s3 provider (production)", () => {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const requests: { method: string; url: string; hasAuth: boolean }[] = [];
  let server: http.Server;
  let endpoint: string;

  beforeAll(async () => {
    // Minimal S3-compatible server (path-style PUT/GET), enough to exercise the
    // real AWS SDK client used in production without any network access.
    server = http.createServer((req, res) => {
      const url = (req.url ?? "").split("?")[0]!;
      requests.push({ method: req.method ?? "", url, hasAuth: !!req.headers.authorization });
      if (req.method === "PUT") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          objects.set(url, {
            body: Buffer.concat(chunks),
            contentType: String(req.headers["content-type"] ?? "")
          });
          res.writeHead(200, { ETag: '"test"' });
          res.end();
        });
        return;
      }
      if (req.method === "GET") {
        const obj = objects.get(url);
        if (!obj) {
          res.writeHead(404, { "Content-Type": "application/xml" });
          res.end("<Error><Code>NoSuchKey</Code></Error>");
          return;
        }
        res.writeHead(200, { "Content-Type": obj.contentType, "Content-Length": obj.body.length });
        res.end(obj.body);
        return;
      }
      res.writeHead(405);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function configureS3() {
    process.env.STORAGE_PROVIDER = "s3";
    process.env.STORAGE_BUCKET = "test-bucket";
    process.env.STORAGE_REGION = "us-east-1";
    process.env.STORAGE_ENDPOINT = endpoint;
    process.env.STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
  }

  it("uploads to and reads back from the bucket with signed requests", async () => {
    configureS3();
    const { storeObject, readObject } = await loadStorage();

    const bytes = new Uint8Array([9, 8, 7, 6]);
    await storeObject("2026-09/photo.png", bytes, "image/png");

    const stored = objects.get("/test-bucket/2026-09/photo.png");
    expect(stored).toBeDefined();
    expect(stored!.contentType).toBe("image/png");
    expect(Array.from(stored!.body)).toEqual([9, 8, 7, 6]);
    expect(requests.every((r) => r.hasAuth)).toBe(true);

    expect(Array.from(await readObject("2026-09/photo.png"))).toEqual([9, 8, 7, 6]);
  });

  it("fails clearly when credentials are missing", async () => {
    configureS3();
    delete process.env.STORAGE_SECRET_ACCESS_KEY;
    const { storeObject } = await loadStorage();
    await expect(storeObject("k.png", new Uint8Array([1]), "image/png")).rejects.toThrow(/STORAGE_SECRET_ACCESS_KEY|STORAGE_REGION/);
  });

  it("fails clearly when the bucket is missing", async () => {
    configureS3();
    delete process.env.STORAGE_BUCKET;
    const { storeObject } = await loadStorage();
    await expect(storeObject("k.png", new Uint8Array([1]), "image/png")).rejects.toThrow(/STORAGE_BUCKET/);
  });
});
