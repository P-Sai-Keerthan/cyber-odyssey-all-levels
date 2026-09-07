#!/bin/sh
# Creates the Portal's database beside Level 1's.
#
# Runs ONCE, from the official postgres image's entrypoint, and only when the
# data directory is empty. The image creates POSTGRES_DB (Level 1's) for us;
# this adds the Portal's, owned by the same role so one credential serves both.
#
# Idempotent anyway: an existing database is left alone rather than failing the
# whole container start.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE ${PORTAL_DB:-odyssey_portal} OWNER ${POSTGRES_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PORTAL_DB:-odyssey_portal}')\gexec
EOSQL
echo "[init] Portal database ${PORTAL_DB:-odyssey_portal} is present."
