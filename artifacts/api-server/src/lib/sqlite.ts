import pg from "pg";
import { logger } from "./logger";

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export async function initDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  _pool = new Pool({ connectionString });
  logger.info("PostgreSQL database pool initialized");

  const db = getDb();
  
  // Initialize tables in PostgreSQL
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      drcash_token VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'ativo',
      budget REAL NOT NULL DEFAULT 0,
      cpc REAL NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      roas REAL NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,
      google_campaign_id VARCHAR(255),
      target_ages TEXT,
      target_genders TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS performance_data (
      id SERIAL PRIMARY KEY,
      date VARCHAR(50) NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id SERIAL PRIMARY KEY,
      keyword VARCHAR(255) NOT NULL,
      search_volume INTEGER NOT NULL DEFAULT 0,
      competition VARCHAR(50) NOT NULL DEFAULT 'média',
      cpc REAL NOT NULL DEFAULT 0,
      location VARCHAR(100) NOT NULL DEFAULT 'Brasil',
      period VARCHAR(50) NOT NULL DEFAULT '12 meses',
      analysis TEXT,
      intent VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS keyword_trends (
      id SERIAL PRIMARY KEY,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      month VARCHAR(50) NOT NULL,
      volume INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Run migrations asynchronously
  try {
    await db.exec("ALTER TABLE users ADD COLUMN drcash_token VARCHAR(255);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE campaigns ADD COLUMN google_campaign_id VARCHAR(255);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE campaigns ADD COLUMN target_ages TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE campaigns ADD COLUMN target_genders TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE keywords ADD COLUMN analysis TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE keywords ADD COLUMN intent VARCHAR(100);");
  } catch (e) {}

  return db;
}

class PostgresStatement {
  private sql: string;

  constructor(sql: string) {
    this.sql = sql;
  }

  private convertQuery(args: any[]): { sql: string; values: any[] } {
    let querySql = this.sql;

    // Convert SQL functions and keywords
    querySql = querySql.replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP");
    querySql = querySql.replace(/\blike\b/gi, "ILIKE");

    // Convert ? placeholders to $1, $2, ...
    let count = 1;
    querySql = querySql.replace(/\?/g, () => `$${count++}`);

    // If query starts with INSERT, append RETURNING * if not present
    const isInsert = /^\s*insert\s+into/i.test(querySql);
    if (isInsert && !/returning/i.test(querySql)) {
      querySql += " RETURNING *";
    }

    return { sql: querySql, values: args };
  }

  async get(...args: any[]): Promise<any> {
    if (!_pool) throw new Error("Database not initialized");
    const { sql, values } = this.convertQuery(args);
    try {
      const res = await _pool.query(sql, values);
      return res.rows[0] || undefined;
    } catch (err: any) {
      logger.error({ sql, values, err: err.message }, "Error executing get query");
      throw err;
    }
  }

  async all(...args: any[]): Promise<any[]> {
    if (!_pool) throw new Error("Database not initialized");
    const { sql, values } = this.convertQuery(args);
    try {
      const res = await _pool.query(sql, values);
      return res.rows;
    } catch (err: any) {
      logger.error({ sql, values, err: err.message }, "Error executing all query");
      throw err;
    }
  }

  async run(...args: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    if (!_pool) throw new Error("Database not initialized");
    const { sql, values } = this.convertQuery(args);
    try {
      const res = await _pool.query(sql, values);
      const changes = res.rowCount || 0;
      let lastInsertRowid = 0;
      if (res.rows && res.rows[0] && res.rows[0].id !== undefined) {
        lastInsertRowid = res.rows[0].id;
      }
      return { changes, lastInsertRowid };
    } catch (err: any) {
      logger.error({ sql, values, err: err.message }, "Error executing run query");
      throw err;
    }
  }
}

class PostgresDbBridge {
  async exec(sql: string): Promise<void> {
    if (!_pool) throw new Error("Database not initialized");
    try {
      await _pool.query(sql);
    } catch (err: any) {
      logger.error({ sql, err: err.message }, "Error executing exec script");
      throw err;
    }
  }

  prepare(sql: string): PostgresStatement {
    return new PostgresStatement(sql);
  }
}

const _dbInstance = new PostgresDbBridge();

export function getDb() {
  if (!_pool) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return _dbInstance;
}
