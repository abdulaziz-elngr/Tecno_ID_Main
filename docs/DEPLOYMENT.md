# Deploying TecnoID

## 1. Requirements

- Node.js 20+
- PostgreSQL 14+
- An S3-compatible bucket for file storage in production (`local`
  storage is dev-only — it writes to disk on the app server, which
  doesn't survive redeploys or multi-instance hosting)
- WhatsApp needs no setup: staff open plain wa.me chat links (see
  `docs/WHATSAPP.md`)

## 2. Environment variables

Copy `.env.example` to `.env` and fill in every value marked
`CHANGE_ME`. At minimum for a working deployment:

- `DATABASE_URL`
- `AUTH_SECRET` (`openssl rand -base64 48`)
- `STORAGE_PROVIDER` + the matching storage credentials (or
  `STORAGE_LOCAL_DIR`/`STORAGE_PUBLIC_PREFIX` for a single-instance
  dev/staging deployment)

Everything else is optional (see `.env.example`). WhatsApp needs no
environment variables.

## 3. Build steps

```bash
npm install
npx prisma generate
npx prisma migrate deploy   # applies committed migrations, does not create new ones
npm run build
npm run start
```

Run `npm run db:seed` only against a fresh **development** database —
never production. Every seeded record is clearly labeled as demo data
and the seed script upserts on natural keys, so re-running it is safe
but still not something you want live tenant data mixed into.

## 4. `prisma generate` network dependency

`prisma generate` downloads a platform-specific query-engine binary
from `binaries.prisma.sh`. If that host is unreachable (locked-down
CI runner, restrictive egress proxy, air-gapped build), the command
fails with something like:

```
Error: Failed to fetch the engine file at
https://binaries.prisma.sh/.../libquery_engine.so.node.gz - 403 Forbidden
```

Setting `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` does **not** work
around this — it only skips checksum verification, the binary itself
still has to be fetched from the same blocked host. There is no
supported fully-offline fallback for a Debian/OpenSSL 3.0 target
short of vendoring the engine binary yourself ahead of time (see
Prisma's docs on custom engine binary paths if you need this for an
air-gapped deployment).

**Symptom if this happens in your build environment**: the Prisma
package ships a placeholder `@prisma/client` type (`PrismaClient =
any`) so the app still compiles at the JS level, but `npx tsc --noEmit`
fills up with hundreds of `implicit any` errors across every file that
touches `db.*` — none of those are real bugs, they disappear the
moment `prisma generate` succeeds against a reachable
`binaries.prisma.sh`. Don't "fix" them by adding manual type
annotations; fix the network path instead.

**In your actual production/CI environment**, this host is normally
reachable and `prisma generate` just works — this only affects
sandboxes with an explicit binaries.prisma.sh block.

## 5. Zero-downtime notes

- `prisma migrate deploy` is additive-safe for the migrations that
  exist as of this writing (no destructive renames without a
  `--create-only` reviewed migration). Always review a generated
  migration before deploying if you're adding one.
- The app is stateless aside from the DB and file storage — safe to
  run multiple instances behind a load balancer as long as
  `STORAGE_PROVIDER` is not `local`.
- `Session` revocation is server-side (the `Session` table), so
  scaling to multiple instances doesn't affect logout/force-logout
  correctness.

## 6. Post-deploy checklist

- [ ] `GET /api/health` returns `200`
- [ ] Log in with a seeded (dev) or freshly created (prod) admin user
- [ ] A WhatsApp button on an absent student or unpaid row opens a
      `https://wa.me/20...` chat with the message pre-filled
- [ ] A test file upload round-trips through `/api/files/upload` and
      `/api/files/[...key]`
- [ ] Confirm backups are running — see `docs/BACKUP.md`
