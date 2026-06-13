import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { mkdirSync, existsSync } from "fs";
import { logger } from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../data/database.db");

let _db: DatabaseSync | null = null;

export function initDb(): DatabaseSync {
  const dataDir = path.resolve(__dirname, "../../data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);
  logger.info({ path: DB_PATH }, "SQLite database opened");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

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
      created_at TEXT DEFAULT (datetime('now'))
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
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS keyword_trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      volume INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (keyword_id) REFERENCES keywords(id)
    );
  `);

  // Run migrations for existing database files that might be missing new columns
  try {
    db.exec("ALTER TABLE campaigns ADD COLUMN google_campaign_id TEXT;");
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE campaigns ADD COLUMN target_ages TEXT;");
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE campaigns ADD COLUMN target_genders TEXT;");
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE keywords ADD COLUMN analysis TEXT;");
  } catch (e) {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE keywords ADD COLUMN intent TEXT;");
  } catch (e) {
    // Column already exists, ignore
  }

  _db = db;
  return db;
}

export function getDb(): DatabaseSync {
  if (!_db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return _db;
}
