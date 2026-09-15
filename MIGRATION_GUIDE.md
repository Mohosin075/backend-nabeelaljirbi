# 🛡️ Prisma Migration Guide — Production Safe

> **⚠️ CRITICAL:** This is a production project. Follow this guide exactly.
> **Never run `prisma db push` or `prisma migrate reset` against the production database.**

---

## 📋 Command Reference

| Command | Use Case | Data Safe? |
|---|---|---|
| `npm run migrate:prod` | Deploy pending migrations to **production** | ✅ Yes — never drops data |
| `npm run migrate:dev` | Create new migration on **local** only | ✅ Local only |
| `npm run migrate:status` | Check what migrations are pending/applied | ✅ Read-only |
| `npm run db:generate` | Regenerate Prisma Client after schema change | ✅ Yes |
| `npx prisma db push` | 🚫 **DO NOT USE in production** | ⚠️ Can drop columns |
| `npx prisma migrate reset` | 🚫 **NEVER USE** — wipes entire database | 🔴 Destroys all data |

---

## 🚀 First-Time Setup (Run Once)

Because this project has no `migrations/` folder yet, follow these steps **once**:

### Step 1 — Create baseline migration (LOCAL only)
```bash
# On your local machine, with your LOCAL database URL
npx prisma migrate dev --name init
```
This creates `prisma/migrations/` folder. It does NOT touch production.

### Step 2 — Mark production DB as already up-to-date
```bash
# On the production server (or with production DATABASE_URL)
# This tells Prisma "the DB already has this schema, don't apply it"
npx prisma migrate resolve --applied "TIMESTAMP_init"
# Replace TIMESTAMP_init with the actual folder name created in Step 1
# e.g., "20260101000000_init"
```

### Step 3 — Verify status
```bash
npm run migrate:status
# Should show: All migrations have been applied
```

---

## 🔄 Making Schema Changes (Normal Workflow)

### Step 1 — Edit `prisma/schema.prisma` locally
Make your changes (add fields, add models, etc.)

### Step 2 — Create migration file locally
```bash
# Run LOCALLY — never on production
npm run migrate:dev -- --name describe_your_change
# Example: npm run migrate:dev -- --name add_clinic_website_field
```
This creates a new SQL file in `prisma/migrations/`.

### Step 3 — Review the generated SQL
```bash
cat prisma/migrations/TIMESTAMP_describe_your_change/migration.sql
```
> ⚠️ **Check for `DROP COLUMN`, `DROP TABLE` statements.**
> If you see them, it means data will be lost. Consider a safer approach
> (rename in 2 steps, or keep old column temporarily).

### Step 4 — Commit and push to git

### Step 5 — Deploy to production
```bash
# On the production server, after pulling latest code:
npm run migrate:prod
```
`prisma migrate deploy`:
- ✅ Only applies **pending** migrations
- ✅ Never rolls back or resets existing data
- ✅ Is idempotent — safe to run multiple times
- ✅ Records which migrations have been applied

---

## ⚠️ Dangerous Operations — How to Handle Safely

### Renaming a column (DATA LOSS RISK)
❌ **Wrong way** (Prisma will DROP old column, ADD new column = data lost):
```
Before: name String?
After:  clinicTitle String?   <- Prisma sees this as delete+create
```

✅ **Safe way** — Do it in 3 steps across 3 migrations:
```
Step 1: Add new column (keep old)     -> migrate -> deploy
Step 2: Copy data with a script       -> run script on production
Step 3: Remove old column             -> migrate -> deploy
```

### Adding a required field to existing table
```prisma
// Fails if table has existing rows:
newField String

// Safe — provide a default:
newField String @default("")

// Or make it optional:
newField String?
```

---

## 🔍 Checking Migration Status

```bash
npm run migrate:status
```

Output means:
- `✅ 20260101_init` — applied
- `⚠️ 20260201_add_field` — pending (run `migrate:prod`)
- `❌ drift detected` — schema.prisma doesn't match DB (dangerous!)

---

## ✅ Summary — Golden Rules

1. **Local dev** → `npm run migrate:dev`
2. **Production deploy** → `npm run migrate:prod` only
3. **Never** → `prisma db push` or `prisma migrate reset` on production
4. **Always** → review generated SQL before deploying
5. **Always** → backup production DB before any migration
