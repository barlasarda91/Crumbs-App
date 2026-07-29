import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { nowISO } from "./dates.js";

// Railway volume at /data when present; ./data for local dev
const DEFAULT_DATA_DIR = fs.existsSync("/data") ? "/data" : "./data";
export const DB_PATH = process.env.DB_PATH || path.join(DEFAULT_DATA_DIR, "crumbs.db");
export const INVOICE_DIR = process.env.INVOICE_DIR || path.join(DEFAULT_DATA_DIR, "invoices");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(INVOICE_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── Migrations ───────────────────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS for the base schema, plus numbered incremental
// steps recorded in schema_migrations so later ALTERs never destroy data.

export function dbMigrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL UNIQUE,
      kind          TEXT NOT NULL,
      email_pattern TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS standing_order_versions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      effective_date TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      note           TEXT
    );

    CREATE TABLE IF NOT EXISTS standing_order_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id  INTEGER NOT NULL REFERENCES standing_order_versions(id) ON DELETE CASCADE,
      item_name   TEXT NOT NULL,
      vendor_id   INTEGER REFERENCES vendors(id),
      day_of_week TEXT NOT NULL,
      qty         REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_soi_version ON standing_order_items(version_id);

    CREATE TABLE IF NOT EXISTS invoices (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id        INTEGER REFERENCES vendors(id),
      invoice_number   TEXT,
      invoice_date     TEXT,
      source           TEXT NOT NULL,
      gmail_message_id TEXT,
      gmail_attachment_id TEXT,
      pdf_path         TEXT,
      subtotal         REAL,
      tax              REAL,
      total            REAL,
      status           TEXT NOT NULL DEFAULT 'pending_review',
      extraction_raw   TEXT,
      extraction_error TEXT,
      extracted_at     TEXT,
      confirmed_at     TEXT,
      created_at       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inv_vendor_date ON invoices(vendor_id, invoice_date);
    CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_gmail_dedup
      ON invoices(gmail_message_id, gmail_attachment_id)
      WHERE gmail_message_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS invoice_line_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      sku           TEXT,
      description   TEXT NOT NULL,
      qty           REAL NOT NULL,
      unit          TEXT,
      units_per_pack REAL,
      unit_price    REAL NOT NULL,
      line_total    REAL NOT NULL,
      consumable_id INTEGER REFERENCES consumables(id),
      edited        INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ili_invoice ON invoice_line_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_ili_sku ON invoice_line_items(sku);

    CREATE TABLE IF NOT EXISTS consumables (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      method             TEXT NOT NULL,
      denominator        TEXT NOT NULL,
      rolling_window_days INTEGER,
      window_auto        INTEGER NOT NULL DEFAULT 1,
      active             INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consumable_sku_patterns (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      consumable_id INTEGER NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
      vendor_id     INTEGER REFERENCES vendors(id),
      pattern       TEXT NOT NULL,
      units_per_pack_override REAL
    );

    CREATE TABLE IF NOT EXISTS consumable_rules (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      consumable_id   INTEGER NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
      match_type      TEXT NOT NULL,
      match_value     TEXT NOT NULL,
      units_per_match REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consumable_baselines (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      consumable_id         INTEGER NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
      computed_at           TEXT NOT NULL,
      window_start          TEXT NOT NULL,
      window_end            TEXT NOT NULL,
      denominator_count     REAL NOT NULL,
      units_purchased       REAL,
      total_spend           REAL NOT NULL,
      cost_per_denominator  REAL NOT NULL,
      units_per_denominator REAL,
      purchase_events       INTEGER NOT NULL,
      confidence            TEXT NOT NULL,
      expected_units        REAL,
      variance_units        REAL,
      variance_pct          REAL
    );
    CREATE INDEX IF NOT EXISTS idx_cb_consumable ON consumable_baselines(consumable_id, computed_at);

    CREATE TABLE IF NOT EXISTS price_observations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
      sku_key       TEXT NOT NULL,
      observed_date TEXT NOT NULL,
      unit_price    REAL NOT NULL,
      unit          TEXT,
      invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_po_key ON price_observations(vendor_id, sku_key, observed_date);

    CREATE TABLE IF NOT EXISTS price_alerts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id     INTEGER NOT NULL REFERENCES vendors(id),
      sku_key       TEXT NOT NULL,
      kind          TEXT NOT NULL DEFAULT 'price',
      old_price     REAL NOT NULL,
      new_price     REAL NOT NULL,
      pct_change    REAL NOT NULL,
      old_unit      TEXT,
      new_unit      TEXT,
      old_date      TEXT NOT NULL,
      new_date      TEXT NOT NULL,
      invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      acknowledged  INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS square_daily_metrics (
      date              TEXT PRIMARY KEY,
      transaction_count INTEGER NOT NULL,
      drink_count       INTEGER NOT NULL,
      item_counts       TEXT NOT NULL,
      category_counts   TEXT NOT NULL,
      synced_at         TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      provider      TEXT PRIMARY KEY,
      account_email TEXT,
      access_token  TEXT,
      refresh_token TEXT,
      expires_at    TEXT,
      scope         TEXT,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type     TEXT NOT NULL,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      status       TEXT NOT NULL,
      message      TEXT,
      items_processed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Incremental ALTER TABLE migrations go here as [id, sql] pairs.
  const steps = [];
  const applied = new Set(db.prepare("SELECT id FROM schema_migrations").all().map(r => r.id));
  for (const [id, sql] of steps) {
    if (applied.has(id)) continue;
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(id, nowISO());
  }

  seedVendors();
}

function seedVendors() {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO vendors (name, kind, email_pattern, created_at) VALUES (?, ?, ?, ?)"
  );
  // email_pattern left NULL for supply vendors — filled from real invoice
  // emails via the Settings UI rather than hardcoded guesses.
  const seed = [
    ["Shoreline",    "supply"],
    ["Odeko",        "supply"],
    ["Sam Robinson", "pastry"],
    ["Oh La La",     "pastry"],
  ];
  for (const [name, kind] of seed) insert.run(name, kind, null, nowISO());
}

// ─── Settings ─────────────────────────────────────────────────────────────────
const SETTING_DEFAULTS = {
  price_alert_threshold_pct: 3,
  drink_categories: [],   // Square category names that count as a "drink"
  drink_items: [],        // Square item names that count as a "drink"
};

export function getSetting(key) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  if (!row) return SETTING_DEFAULTS[key];
  try { return JSON.parse(row.value); } catch { return SETTING_DEFAULTS[key]; }
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, JSON.stringify(value));
}

export function getAllSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const row of db.prepare("SELECT key, value FROM app_settings").all()) {
    try { out[row.key] = JSON.parse(row.value); } catch {}
  }
  return out;
}

// ─── Sync log helper ──────────────────────────────────────────────────────────
export function logJob(jobType, fn) {
  const started = nowISO();
  const { lastInsertRowid: id } = db.prepare(
    "INSERT INTO sync_log (job_type, started_at, status) VALUES (?, ?, 'running')"
  ).run(jobType, started);
  const finish = (status, message, items = 0) =>
    db.prepare("UPDATE sync_log SET finished_at = ?, status = ?, message = ?, items_processed = ? WHERE id = ?")
      .run(nowISO(), status, message ?? null, items, id);
  return Promise.resolve()
    .then(fn)
    .then(result => {
      finish("success", result?.message, result?.items ?? 0);
      return result;
    })
    .catch(err => {
      finish("error", err.message);
      throw err;
    });
}
