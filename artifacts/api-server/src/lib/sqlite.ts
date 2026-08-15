import pg from "pg";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { logger } from "./logger";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname_here = path.dirname(__filename);
// artifacts/api-server/src/lib -> artifacts/data/database.db
const LOCAL_SQLITE_PATH = path.resolve(__dirname_here, "../../../data/database.db");

type DbBridge = PostgresDbBridge | SqliteDbBridge;

let _pool: pg.Pool | null = null;
let _sqlite: Database.Database | null = null;
let _dbInstance: DbBridge | null = null;

/**
 * Development defaults to the local SQLite file even when a legacy
 * DATABASE_URL is present in .env. Production may use DATABASE_URL, and
 * DATABASE_MODE can explicitly select either backend when needed.
 */
export async function initDb() {
  const databaseMode = process.env.DATABASE_MODE?.trim().toLowerCase();
  const connectionString = process.env.DATABASE_URL;

  if (databaseMode === "sqlite") {
    return initSqliteDb();
  }

  if (databaseMode === "postgres") {
    if (!connectionString) {
      throw new Error("DATABASE_URL is required when DATABASE_MODE=postgres");
    }
    return initPostgresDb();
  }

  if (process.env.NODE_ENV === "production" && connectionString) {
    return initPostgresDb();
  }

  return initSqliteDb();
}

async function initPostgresDb() {
  const connectionString = process.env.DATABASE_URL!;
  _pool = new Pool({ connectionString });
  const db = new PostgresDbBridge();
  _dbInstance = db;
  logger.info("PostgreSQL database pool initialized");

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

    CREATE TABLE IF NOT EXISTS admin_accounts (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role_name VARCHAR(100) NOT NULL DEFAULT 'Equipe',
      permissions TEXT NOT NULL,
      is_owner BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true,
      created_by INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cash_ledger (
      id SERIAL PRIMARY KEY,
      movement_type VARCHAR(20) NOT NULL,
      amount REAL NOT NULL,
      description VARCHAR(255) NOT NULL,
      category VARCHAR(100),
      payment_method VARCHAR(100),
      movement_date DATE NOT NULL,
      created_by INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
      action VARCHAR(100) NOT NULL,
      target_type VARCHAR(50),
      target_id VARCHAR(100),
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id ON admin_audit_logs(admin_id);

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
      target_locations TEXT,
      target_languages TEXT,
      bidding_strategy VARCHAR(100),
      ad_networks TEXT,
      start_date VARCHAR(50),
      end_date VARCHAR(50),
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS keyword_trends (
      id SERIAL PRIMARY KEY,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      month VARCHAR(50) NOT NULL,
      volume INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS google_ads_connections (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_encrypted TEXT NOT NULL,
      customer_id VARCHAR(255),
      login_customer_id VARCHAR(255),
      accessible_customer_ids TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS presells (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      reference_url TEXT,
      destination_url TEXT NOT NULL,
      product_name VARCHAR(255),
      product_category VARCHAR(100),
      selected_option VARCHAR(50),
      published_url TEXT,
      publish_path TEXT,
      published_html TEXT,
      thank_you_html TEXT,
      thank_you_file_name VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'local',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      mp_payment_id VARCHAR(255) UNIQUE,
      mp_preference_id VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      status_detail VARCHAR(255),
      payment_method_id VARCHAR(100),
      payment_type_id VARCHAR(100),
      transaction_amount REAL NOT NULL DEFAULT 0,
      payer_email VARCHAR(255),
      plan_tier VARCHAR(50) NOT NULL DEFAULT 'pro',
      billing_cycle VARCHAR(20) DEFAULT 'monthly',
      qr_code TEXT,
      qr_code_base64 TEXT,
      ticket_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Run migrations asynchronously
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS presells (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reference_url TEXT,
        destination_url TEXT NOT NULL,
        product_name VARCHAR(255),
        product_category VARCHAR(100),
        selected_option VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {}
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        mp_payment_id VARCHAR(255) UNIQUE,
        mp_preference_id VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        status_detail VARCHAR(255),
        payment_method_id VARCHAR(100),
        payment_type_id VARCHAR(100),
        transaction_amount REAL NOT NULL DEFAULT 0,
        payer_email VARCHAR(255),
        plan_tier VARCHAR(50) NOT NULL DEFAULT 'pro',
        billing_cycle VARCHAR(20) DEFAULT 'monthly',
        qr_code TEXT,
        qr_code_base64 TEXT,
        ticket_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {}
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS support_chats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subject VARCHAR(255) DEFAULT 'Suporte ao Cliente',
        status VARCHAR(50) NOT NULL DEFAULT 'open',
        last_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {}
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER REFERENCES support_chats(id) ON DELETE CASCADE,
        sender_type VARCHAR(20) NOT NULL,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN drcash_token VARCHAR(255);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user';");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN is_temporary BOOLEAN DEFAULT false;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN subscription_tier VARCHAR(50) DEFAULT 'free';");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN subscription_status VARCHAR(50) DEFAULT 'free';");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN subscription_id VARCHAR(255);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN mercadopago_customer_id VARCHAR(255);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN subscription_expires_at TIMESTAMP;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE users ADD COLUMN account_status VARCHAR(20) NOT NULL DEFAULT 'active';");
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
  try {
    await db.exec("ALTER TABLE keywords ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE campaigns ADD COLUMN target_locations TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE campaigns ADD COLUMN target_languages TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE campaigns ADD COLUMN bidding_strategy VARCHAR(100);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE campaigns ADD COLUMN ad_networks TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE campaigns ADD COLUMN start_date VARCHAR(50);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE campaigns ADD COLUMN end_date VARCHAR(50);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN published_url TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN publish_path TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN published_html TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN thank_you_html TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN thank_you_file_name VARCHAR(255);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'local';");
  } catch (e) {}
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ai_usage_daily (
        usage_date DATE PRIMARY KEY,
        tokens_used INTEGER NOT NULL DEFAULT 0
      );
    `);
  } catch (e) {}

  return db;
}

/**
 * Local dev database — real SQLite file, no remote/network dependency.
 * Schema mirrors initPostgresDb() (SERIAL -> INTEGER PRIMARY KEY AUTOINCREMENT,
 * VARCHAR(n) -> TEXT, etc). Missing columns on a pre-existing local file are
 * added the same idempotent way as the Postgres migrations below.
 */
async function initSqliteDb() {
  fs.mkdirSync(path.dirname(LOCAL_SQLITE_PATH), { recursive: true });
  _sqlite = new Database(LOCAL_SQLITE_PATH);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  const db = new SqliteDbBridge();
  _dbInstance = db;
  logger.info({ path: LOCAL_SQLITE_PATH }, "Local SQLite database initialized");

  db.execSync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      drcash_token TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      role TEXT DEFAULT 'user',
      is_temporary BOOLEAN DEFAULT 0,
      subscription_tier TEXT DEFAULT 'free',
      subscription_status TEXT DEFAULT 'free',
      subscription_id TEXT,
      mercadopago_customer_id TEXT,
      subscription_expires_at TIMESTAMP,
      account_status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS admin_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role_name TEXT NOT NULL DEFAULT 'Equipe',
      permissions TEXT NOT NULL,
      is_owner BOOLEAN NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT 1,
      created_by INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cash_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      category TEXT,
      payment_method TEXT,
      movement_date TEXT NOT NULL,
      created_by INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER REFERENCES admin_accounts(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_id ON admin_audit_logs(admin_id);

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ativo',
      budget REAL NOT NULL DEFAULT 0,
      cpc REAL NOT NULL DEFAULT 0,
      ctr REAL NOT NULL DEFAULT 0,
      roas REAL NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,
      google_campaign_id TEXT,
      target_ages TEXT,
      target_genders TEXT,
      target_locations TEXT,
      target_languages TEXT,
      bidding_strategy TEXT,
      ad_networks TEXT,
      start_date TEXT,
      end_date TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS performance_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0,
      conversions INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      search_volume INTEGER NOT NULL DEFAULT 0,
      competition TEXT NOT NULL DEFAULT 'média',
      cpc REAL NOT NULL DEFAULT 0,
      location TEXT NOT NULL DEFAULT 'Brasil',
      period TEXT NOT NULL DEFAULT '12 meses',
      analysis TEXT,
      intent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS keyword_trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      volume INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS google_ads_connections (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_encrypted TEXT NOT NULL,
      customer_id TEXT,
      login_customer_id TEXT,
      accessible_customer_ids TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS presells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      reference_url TEXT,
      destination_url TEXT NOT NULL,
      product_name TEXT,
      product_category TEXT,
      selected_option TEXT,
      published_url TEXT,
      publish_path TEXT,
      published_html TEXT,
      thank_you_html TEXT,
      thank_you_file_name TEXT,
      status TEXT NOT NULL DEFAULT 'local',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      mp_payment_id TEXT UNIQUE,
      mp_preference_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      status_detail TEXT,
      payment_method_id TEXT,
      payment_type_id TEXT,
      transaction_amount REAL NOT NULL DEFAULT 0,
      payer_email TEXT,
      plan_tier TEXT NOT NULL DEFAULT 'pro',
      billing_cycle TEXT DEFAULT 'monthly',
      qr_code TEXT,
      qr_code_base64 TEXT,
      ticket_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS support_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      subject TEXT DEFAULT 'Suporte ao Cliente',
      status TEXT NOT NULL DEFAULT 'open',
      last_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER REFERENCES support_chats(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL,
      sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_read BOOLEAN DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      usage_date DATE PRIMARY KEY,
      tokens_used INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Upgrade a pre-existing local file that predates one of the columns above
  // (same idempotent pattern as initPostgresDb — SQLite throws "duplicate
  // column name" when it already exists, which we simply swallow).
  const alterStatements = [
    "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';",
    "ALTER TABLE users ADD COLUMN is_temporary BOOLEAN DEFAULT 0;",
    "ALTER TABLE users ADD COLUMN subscription_tier TEXT DEFAULT 'free';",
    "ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'free';",
    "ALTER TABLE users ADD COLUMN subscription_id TEXT;",
    "ALTER TABLE users ADD COLUMN mercadopago_customer_id TEXT;",
    "ALTER TABLE users ADD COLUMN subscription_expires_at TIMESTAMP;",
    "ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active';",
    "ALTER TABLE campaigns ADD COLUMN target_locations TEXT;",
    "ALTER TABLE campaigns ADD COLUMN target_languages TEXT;",
    "ALTER TABLE campaigns ADD COLUMN bidding_strategy TEXT;",
    "ALTER TABLE campaigns ADD COLUMN ad_networks TEXT;",
    "ALTER TABLE campaigns ADD COLUMN start_date TEXT;",
    "ALTER TABLE campaigns ADD COLUMN end_date TEXT;",
    "ALTER TABLE keywords ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;",
    "ALTER TABLE presells ADD COLUMN published_url TEXT;",
    "ALTER TABLE presells ADD COLUMN publish_path TEXT;",
    "ALTER TABLE presells ADD COLUMN published_html TEXT;",
    "ALTER TABLE presells ADD COLUMN thank_you_html TEXT;",
    "ALTER TABLE presells ADD COLUMN thank_you_file_name TEXT;",
    "ALTER TABLE presells ADD COLUMN status TEXT NOT NULL DEFAULT 'local';",
  ];
  for (const stmt of alterStatements) {
    try {
      db.execSync(stmt);
    } catch (e) {}
  }

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

// better-sqlite3 is synchronous end-to-end; queries in this codebase were
// originally written in SQLite dialect (?-placeholders, case-insensitive
// LIKE, datetime('now')), so — unlike PostgresStatement — nothing needs to
// be rewritten here, and .run() already returns lastInsertRowid natively.
class SqliteStatement {
  constructor(private stmt: Database.Statement) {}

  async get(...args: any[]): Promise<any> {
    try {
      return this.stmt.get(...args);
    } catch (err: any) {
      logger.error({ sql: this.stmt.source, err: err.message }, "Error executing get query");
      throw err;
    }
  }

  async all(...args: any[]): Promise<any[]> {
    try {
      return this.stmt.all(...args) as any[];
    } catch (err: any) {
      logger.error({ sql: this.stmt.source, err: err.message }, "Error executing all query");
      throw err;
    }
  }

  async run(...args: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    try {
      const res = this.stmt.run(...args);
      return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
    } catch (err: any) {
      logger.error({ sql: this.stmt.source, err: err.message }, "Error executing run query");
      throw err;
    }
  }
}

class SqliteDbBridge {
  async exec(sql: string): Promise<void> {
    if (!_sqlite) throw new Error("Database not initialized");
    try {
      _sqlite.exec(sql);
    } catch (err: any) {
      logger.error({ sql, err: err.message }, "Error executing exec script");
      throw err;
    }
  }

  // Synchronous variant used only during initSqliteDb() (schema setup runs
  // before any request handling, so there is no need to route it through the
  // async exec() above).
  execSync(sql: string): void {
    if (!_sqlite) throw new Error("Database not initialized");
    _sqlite.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    if (!_sqlite) throw new Error("Database not initialized");
    return new SqliteStatement(_sqlite.prepare(sql));
  }
}

export function getDb(): DbBridge {
  if (!_dbInstance) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return _dbInstance;
}
