# Archived SQLite migration history

These are the migrations that built the portal's SQLite database, kept for
reference only. They are **not** replayed any more and Prisma does not look here.

## Why they were retired

The portal moved to PostgreSQL for the event. A Prisma migration directory is
provider-specific — `migration_lock.toml` records the provider, and this history
is written in SQLite dialect (`PRAGMA defer_foreign_keys`, SQLite's
table-rebuild pattern for altering columns, `DATETIME`). None of it executes on
PostgreSQL.

The supported path for a provider switch is a fresh baseline generated from the
schema, which is what `prisma/migrations/0_init` now is. It produces exactly the
same logical schema — same 29 models, same relations, same unique constraints
and indexes — expressed in PostgreSQL.

## What this means in practice

- A fresh PostgreSQL database is built by `prisma migrate deploy` from `0_init`.
- Existing SQLite data is NOT migrated automatically. The pre-event database is
  seed and test data, so it is recreated with `npm run db:seed` and
  `npm run seed:local-test`. If a populated SQLite database ever needs carrying
  across, export it and import it explicitly — do not point Prisma at both.
- Nothing here should be edited. It is history.
