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
      lemon_offer_id VARCHAR(255),
      lemon_webmaster_token TEXT,
      lemon_cost VARCHAR(40),
      lemon_success_file VARCHAR(255),
      lemon_submit_token VARCHAR(64) UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'local',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tracking_sites (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      presell_id INTEGER REFERENCES presells(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      site_key VARCHAR(64) UNIQUE NOT NULL,
      slug VARCHAR(80) UNIQUE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tracking_sites_user ON tracking_sites(user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_sites_presell_unique ON tracking_sites(presell_id) WHERE presell_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS tracking_visits (
      id SERIAL PRIMARY KEY,
      presell_id INTEGER REFERENCES presells(id) ON DELETE CASCADE,
      tracking_site_id INTEGER REFERENCES tracking_sites(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      visit_token VARCHAR(64) UNIQUE NOT NULL,
      visitor_key VARCHAR(64) NOT NULL,
      ip_address VARCHAR(100),
      country_code VARCHAR(10),
      country_name VARCHAR(100),
      city VARCHAR(150),
      device_type VARCHAR(30) NOT NULL DEFAULT 'desktop',
      browser VARCHAR(80),
      operating_system VARCHAR(80),
      user_agent TEXT,
      referrer TEXT,
      page_path TEXT,
      traffic_source VARCHAR(20) NOT NULL DEFAULT 'organic',
      clicks INTEGER NOT NULL DEFAULT 0,
      clicked_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tracking_visits_user_created ON tracking_visits(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tracking_visits_presell_created ON tracking_visits(presell_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tracking_visits_visitor ON tracking_visits(visitor_key);

    CREATE TABLE IF NOT EXISTS postback_integrations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider VARCHAR(40) NOT NULL DEFAULT 'lemonad',
      token VARCHAR(64) UNIQUE NOT NULL,
      name VARCHAR(80),
      expires_at TIMESTAMP,
      last_tested_at TIMESTAMP,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, provider)
    );

    CREATE TABLE IF NOT EXISTS postback_events (
      id SERIAL PRIMARY KEY,
      integration_id INTEGER NOT NULL REFERENCES postback_integrations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tracking_visit_id INTEGER REFERENCES tracking_visits(id) ON DELETE SET NULL,
      provider VARCHAR(40) NOT NULL DEFAULT 'lemonad',
      event_key VARCHAR(64) NOT NULL,
      external_event_id VARCHAR(255),
      click_id VARCHAR(255),
      status VARCHAR(100) NOT NULL,
      status_group VARCHAR(30) NOT NULL DEFAULT 'pending',
      payout REAL NOT NULL DEFAULT 0,
      currency VARCHAR(16),
      utm_campaign TEXT,
      utm_content TEXT,
      utm_medium TEXT,
      utm_source TEXT,
      utm_term TEXT,
      raw_payload TEXT,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(integration_id, event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_postback_events_user_received ON postback_events(user_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_postback_events_visit ON postback_events(tracking_visit_id);

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
    await db.exec("ALTER TABLE presells ADD COLUMN lemon_offer_id VARCHAR(255);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN lemon_webmaster_token TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN lemon_cost VARCHAR(40);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN lemon_success_file VARCHAR(255);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN lemon_submit_token VARCHAR(64);");
  } catch (e) {}
  try {
    await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_presells_lemon_submit_token ON presells(lemon_submit_token) WHERE lemon_submit_token IS NOT NULL;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE presells ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'local';");
  } catch (e) {}
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS tracking_sites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        presell_id INTEGER REFERENCES presells(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        site_key VARCHAR(64) UNIQUE NOT NULL,
        slug VARCHAR(80) UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tracking_sites_user ON tracking_sites(user_id, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_sites_presell_unique ON tracking_sites(presell_id) WHERE presell_id IS NOT NULL;
    `);
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE tracking_visits ALTER COLUMN presell_id DROP NOT NULL;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE tracking_visits ADD COLUMN tracking_site_id INTEGER REFERENCES tracking_sites(id) ON DELETE CASCADE;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE tracking_sites ADD COLUMN slug VARCHAR(80);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE tracking_visits ADD COLUMN traffic_source VARCHAR(20) NOT NULL DEFAULT 'organic';");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE tracking_visits ADD COLUMN user_agent TEXT;");
  } catch (e) {}
  try {
    await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_sites_slug_unique ON tracking_sites(slug) WHERE slug IS NOT NULL;");
  } catch (e) {}
  try {
    await db.exec("UPDATE tracking_visits SET country_code = 'LOCAL', country_name = 'Ambiente local', city = 'Localhost' WHERE ip_address IN ('::1', '127.0.0.1') AND (country_name IS NULL OR country_name = 'Não identificado');");
  } catch (e) {}
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS postback_integrations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(40) NOT NULL DEFAULT 'lemonad',
        token VARCHAR(64) UNIQUE NOT NULL,
        name VARCHAR(80),
        expires_at TIMESTAMP,
        last_tested_at TIMESTAMP,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, provider)
      );
      CREATE TABLE IF NOT EXISTS postback_events (
        id SERIAL PRIMARY KEY,
        integration_id INTEGER NOT NULL REFERENCES postback_integrations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tracking_visit_id INTEGER REFERENCES tracking_visits(id) ON DELETE SET NULL,
        provider VARCHAR(40) NOT NULL DEFAULT 'lemonad',
        event_key VARCHAR(64) NOT NULL,
        external_event_id VARCHAR(255),
        click_id VARCHAR(255),
        status VARCHAR(100) NOT NULL,
        status_group VARCHAR(30) NOT NULL DEFAULT 'pending',
        payout REAL NOT NULL DEFAULT 0,
        currency VARCHAR(16),
        utm_campaign TEXT,
        utm_content TEXT,
        utm_medium TEXT,
        utm_source TEXT,
        utm_term TEXT,
        raw_payload TEXT,
        received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(integration_id, event_key)
      );
      CREATE INDEX IF NOT EXISTS idx_postback_events_user_received ON postback_events(user_id, received_at);
      CREATE INDEX IF NOT EXISTS idx_postback_events_visit ON postback_events(tracking_visit_id);
    `);
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE postback_integrations ADD COLUMN name VARCHAR(80);");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE postback_integrations ADD COLUMN expires_at TIMESTAMP;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE postback_integrations ADD COLUMN last_tested_at TIMESTAMP;");
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
      lemon_offer_id TEXT,
      lemon_webmaster_token TEXT,
      lemon_cost TEXT,
      lemon_success_file TEXT,
      lemon_submit_token TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'local',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tracking_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      presell_id INTEGER REFERENCES presells(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      site_key TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tracking_sites_user ON tracking_sites(user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_sites_presell_unique ON tracking_sites(presell_id) WHERE presell_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS tracking_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      presell_id INTEGER REFERENCES presells(id) ON DELETE CASCADE,
      tracking_site_id INTEGER REFERENCES tracking_sites(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      visit_token TEXT UNIQUE NOT NULL,
      visitor_key TEXT NOT NULL,
      ip_address TEXT,
      country_code TEXT,
      country_name TEXT,
      city TEXT,
      device_type TEXT NOT NULL DEFAULT 'desktop',
      browser TEXT,
      operating_system TEXT,
      user_agent TEXT,
      referrer TEXT,
      page_path TEXT,
      traffic_source TEXT NOT NULL DEFAULT 'organic',
      clicks INTEGER NOT NULL DEFAULT 0,
      clicked_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tracking_visits_user_created ON tracking_visits(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tracking_visits_presell_created ON tracking_visits(presell_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tracking_visits_visitor ON tracking_visits(visitor_key);

    CREATE TABLE IF NOT EXISTS postback_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'lemonad',
      token TEXT UNIQUE NOT NULL,
      name TEXT,
      expires_at TIMESTAMP,
      last_tested_at TIMESTAMP,
      enabled BOOLEAN NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, provider)
    );

    CREATE TABLE IF NOT EXISTS postback_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id INTEGER NOT NULL REFERENCES postback_integrations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tracking_visit_id INTEGER REFERENCES tracking_visits(id) ON DELETE SET NULL,
      provider TEXT NOT NULL DEFAULT 'lemonad',
      event_key TEXT NOT NULL,
      external_event_id TEXT,
      click_id TEXT,
      status TEXT NOT NULL,
      status_group TEXT NOT NULL DEFAULT 'pending',
      payout REAL NOT NULL DEFAULT 0,
      currency TEXT,
      utm_campaign TEXT,
      utm_content TEXT,
      utm_medium TEXT,
      utm_source TEXT,
      utm_term TEXT,
      raw_payload TEXT,
      received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(integration_id, event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_postback_events_user_received ON postback_events(user_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_postback_events_visit ON postback_events(tracking_visit_id);

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
    "ALTER TABLE presells ADD COLUMN lemon_offer_id TEXT;",
    "ALTER TABLE presells ADD COLUMN lemon_webmaster_token TEXT;",
    "ALTER TABLE presells ADD COLUMN lemon_cost TEXT;",
    "ALTER TABLE presells ADD COLUMN lemon_success_file TEXT;",
    "ALTER TABLE presells ADD COLUMN lemon_submit_token TEXT;",
    "ALTER TABLE presells ADD COLUMN status TEXT NOT NULL DEFAULT 'local';",
    "ALTER TABLE tracking_visits ADD COLUMN tracking_site_id INTEGER REFERENCES tracking_sites(id) ON DELETE CASCADE;",
    "ALTER TABLE tracking_sites ADD COLUMN slug TEXT;",
    "ALTER TABLE tracking_visits ADD COLUMN traffic_source TEXT NOT NULL DEFAULT 'organic';",
    "ALTER TABLE tracking_visits ADD COLUMN user_agent TEXT;",
    "ALTER TABLE postback_integrations ADD COLUMN name TEXT;",
    "ALTER TABLE postback_integrations ADD COLUMN expires_at TIMESTAMP;",
    "ALTER TABLE postback_integrations ADD COLUMN last_tested_at TIMESTAMP;",
  ];
  for (const stmt of alterStatements) {
    try {
      db.execSync(stmt);
    } catch (e) {}
  }
  try {
    db.execSync("CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_sites_slug_unique ON tracking_sites(slug) WHERE slug IS NOT NULL;");
  } catch (e) {}
  try {
    db.execSync("CREATE UNIQUE INDEX IF NOT EXISTS idx_presells_lemon_submit_token ON presells(lemon_submit_token) WHERE lemon_submit_token IS NOT NULL;");
  } catch (e) {}
  try {
    db.execSync("UPDATE tracking_visits SET country_code = 'LOCAL', country_name = 'Ambiente local', city = 'Localhost' WHERE ip_address IN ('::1', '127.0.0.1') AND (country_name IS NULL OR country_name = 'Não identificado');");
  } catch (e) {}

  const visitColumns = _sqlite.prepare("PRAGMA table_info(tracking_visits)").all() as Array<{ name: string; notnull: number }>;
  const presellColumn = visitColumns.find((column) => column.name === "presell_id");
  if (presellColumn?.notnull) {
    db.execSync(`
      ALTER TABLE tracking_visits RENAME TO tracking_visits_legacy;
      CREATE TABLE tracking_visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        presell_id INTEGER REFERENCES presells(id) ON DELETE CASCADE,
        tracking_site_id INTEGER REFERENCES tracking_sites(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        visit_token TEXT UNIQUE NOT NULL,
        visitor_key TEXT NOT NULL,
        ip_address TEXT,
        country_code TEXT,
        country_name TEXT,
        city TEXT,
        device_type TEXT NOT NULL DEFAULT 'desktop',
        browser TEXT,
        operating_system TEXT,
        referrer TEXT,
        page_path TEXT,
        traffic_source TEXT NOT NULL DEFAULT 'organic',
        clicks INTEGER NOT NULL DEFAULT 0,
        clicked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO tracking_visits
        (id, presell_id, tracking_site_id, user_id, visit_token, visitor_key, ip_address, country_code, country_name, city, device_type, browser, operating_system, referrer, page_path, traffic_source, clicks, clicked_at, created_at)
      SELECT id, presell_id, tracking_site_id, user_id, visit_token, visitor_key, ip_address, country_code, country_name, city, device_type, browser, operating_system, referrer, page_path, 'organic', clicks, clicked_at, created_at
      FROM tracking_visits_legacy;
      DROP TABLE tracking_visits_legacy;
      CREATE INDEX IF NOT EXISTS idx_tracking_visits_user_created ON tracking_visits(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_tracking_visits_presell_created ON tracking_visits(presell_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_tracking_visits_visitor ON tracking_visits(visitor_key);
    `);
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
