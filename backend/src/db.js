import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.DATABASE_PATH || path.join(dbDir, 'hydroponic.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode
db.exec('PRAGMA journal_mode = WAL;');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      location TEXT DEFAULT 'Lahan AA Hidroponik Tempuran',
      status TEXT DEFAULT 'OFFLINE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sensor_logs (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      ph_value REAL NOT NULL,
      tds_ppm INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sensor_telemetry ON sensor_logs (device_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS event_logs (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      state_name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_logs (device_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS device_settings (
      device_id TEXT PRIMARY KEY,
      ph_min REAL DEFAULT 5.5,
      ph_max REAL DEFAULT 6.5,
      tds_min INTEGER DEFAULT 560,
      tds_max INTEGER DEFAULT 840,
      tds_critical_low INTEGER DEFAULT 450,
      tds_critical_high INTEGER DEFAULT 950,
      dosing_duration_sec INTEGER DEFAULT 5,
      cooldown_duration_sec INTEGER DEFAULT 300,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
    );
  `);

  const eventLogColumns = db.prepare('PRAGMA table_info(event_logs)').all();
  if (!eventLogColumns.some((column) => column.name === 'raw_payload')) {
    db.exec('ALTER TABLE event_logs ADD COLUMN raw_payload TEXT');
  }

  // Seed default device if not exists
  const checkStmt = db.prepare('SELECT device_id FROM devices WHERE device_id = ?');
  const checkDevice = checkStmt.get('ESP32_AUTO_SELADA_01');
  if (!checkDevice) {
    db.prepare(`
      INSERT INTO devices (device_id, device_name, location, status)
      VALUES (?, ?, ?, ?)
    `).run('ESP32_AUTO_SELADA_01', 'AUTO-SELADA Unit 1', 'Lahan AA Hidroponik Tempuran Magelang', 'ONLINE');

    db.prepare(`
      INSERT INTO device_settings (device_id, ph_min, ph_max, tds_min, tds_max, tds_critical_low, tds_critical_high, dosing_duration_sec, cooldown_duration_sec)
      VALUES (?, 5.5, 6.5, 560, 840, 450, 950, 5, 300)
    `).run('ESP32_AUTO_SELADA_01');

    db.prepare(`
      INSERT INTO event_logs (device_id, event_type, state_name, description)
      VALUES (?, 'SYSTEM_INIT', 'NORMAL', 'Initial system initialization for AUTO-SELADA')
    `).run('ESP32_AUTO_SELADA_01');
    console.log('[DB] Initial seed data created for ESP32_AUTO_SELADA_01');
  }
}

export default db;
