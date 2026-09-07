const { Pool } = require("pg");
try {
  require("./loadEnv").loadEnv();
} catch {}

function getValidatedDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url || !url.trim()) {
    throw new Error(
      "[DATABASE CONFIG ERROR] DATABASE_URL environment variable is missing. " +
      "Configure a valid PostgreSQL connection string (e.g., postgresql://user:password@host:5432/dbname)."
    );
  }

  if (url.includes("supabase.co") || url.includes("qtudyqkuuwensqpljurz")) {
    throw new Error(
      "[DATABASE CONFIG ERROR] Obsolete Supabase connection string detected in DATABASE_URL. " +
      "Level 1 requires standard PostgreSQL. Please update DATABASE_URL in .env to point to your PostgreSQL instance."
    );
  }

  return url.trim();
}

const globalForPg = global;

let pool;
try {
  const connectionString = getValidatedDatabaseUrl();
  pool =
    globalForPg.pgPool ||
    new Pool({
      connectionString,
      max: parseInt(process.env.DB_POOL_MAX || "20", 10),
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 10000,
    });

  pool.on("error", (err) => {
    console.error("[PG POOL ERROR] Unexpected idle client error:", err.message);
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPg.pgPool = pool;
  }
} catch (err) {
  console.error(err.message);
  pool = {
    query: async () => {
      throw new Error(err.message);
    },
    end: async () => {},
    on: () => {},
  };
}

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error("[DB QUERY ERROR]", err.message);
    throw err;
  }
}

module.exports = { pool, query, getValidatedDatabaseUrl };

