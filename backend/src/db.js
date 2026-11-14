import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const databaseUrl = process.env.DATABASE_URL;
export const isPostgres = Boolean(databaseUrl && databaseUrl.startsWith('postgres'));

let pgPool = null;
let sqliteDb = null;

if (isPostgres) {
  console.log('[DB] Menggunakan PostgreSQL Database Engine');
  pgPool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
} else {
  console.log('[DB] Menggunakan Local SQLite Database Engine (Mode Standby / Offline)');
  const dbDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = process.env.DATABASE_PATH || path.join(dbDir, 'hydroponic.db');
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
}

/**
 * Universal Query Execution (Async)
 * Supports both PostgreSQL ($1, $2) and SQLite (? or $1)
 */
export async function query(text, params = []) {
  if (isPostgres) {
    const res = await pgPool.query(text, params);
    return res.rows;
  } else {
    // Translate $1, $2 syntax to ? for sqlite if needed
    let sqliteSql = text;
    if (/\$\d+/.test(sqliteSql)) {
      sqliteSql = sqliteSql.replace(/\$\d+/g, '?');
    }
    const stmt = sqliteDb.prepare(sqliteSql);
    // If SELECT query, return all rows
    if (/^\s*SELECT/i.test(sqliteSql)) {
      return stmt.all(...params);
    }
    // If INSERT/UPDATE/DELETE query
    const info = stmt.run(...params);
    return [{ ...info }];
  }
}

/**
 * Universal Query One (Returns single object or null)
 */
export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * Initialize Tables for PostgreSQL or SQLite
 */
export async function initDatabase() {
  if (isPostgres) {
    try {
      const client = await pgPool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS devices (
            device_id VARCHAR(50) PRIMARY KEY,
            device_name VARCHAR(100) NOT NULL,
            location VARCHAR(100) DEFAULT 'Lahan AA Hidroponik Tempuran',
            status VARCHAR(20) DEFAULT 'OFFLINE',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS sensor_logs (
            log_id BIGSERIAL PRIMARY KEY,
            device_id VARCHAR(50) NOT NULL,
            ph_value DECIMAL(4,2) NOT NULL,
            tds_ppm INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_sensor_telemetry ON sensor_logs (device_id, created_at DESC);

          CREATE TABLE IF NOT EXISTS event_logs (
            event_id BIGSERIAL PRIMARY KEY,
            device_id VARCHAR(50) NOT NULL,
            event_type VARCHAR(30) NOT NULL,
            state_name VARCHAR(20) NOT NULL,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
          );

          CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_logs (device_id, created_at DESC);

          CREATE TABLE IF NOT EXISTS device_settings (
            device_id VARCHAR(50) PRIMARY KEY,
            ph_min DECIMAL(3,1) DEFAULT 5.5,
            ph_max DECIMAL(3,1) DEFAULT 6.5,
            tds_min INT DEFAULT 560,
            tds_max INT DEFAULT 840,
            tds_critical_low INT DEFAULT 450,
            tds_critical_high INT DEFAULT 950,
            dosing_duration_sec INT DEFAULT 5,
            cooldown_duration_sec INT DEFAULT 300,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
          );
        `);

        // Seed initial device
        const checkDevice = await client.query('SELECT device_id FROM devices WHERE device_id = $1', ['ESP32_AUTO_SELADA_01']);
        if (checkDevice.rows.length === 0) {
          await client.query(`
            INSERT INTO devices (device_id, device_name, location, status)
            VALUES ($1, $2, $3, $4)
          `, ['ESP32_AUTO_SELADA_01', 'AUTO-SELADA Unit 1', 'Lahan AA Hidroponik Tempuran Magelang', 'ONLINE']);

          await client.query(`
            INSERT INTO device_settings (device_id, ph_min, ph_max, tds_min, tds_max, tds_critical_low, tds_critical_high, dosing_duration_sec, cooldown_duration_sec)
            VALUES ($1, 5.5, 6.5, 560, 840, 450, 950, 5, 300)
          `, ['ESP32_AUTO_SELADA_01']);

          await client.query(`
            INSERT INTO event_logs (device_id, event_type, state_name, description)
            VALUES ($1, 'SYSTEM_INIT', 'NORMAL', 'Initial system initialization for AUTO-SELADA (PostgreSQL)')
          `, ['ESP32_AUTO_SELADA_01']);
          console.log('[PostgreSQL] Initial seed data created for ESP32_AUTO_SELADA_01');
        }
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[PostgreSQL] Error during initDatabase:', err.message);
    }
  } else {
    // SQLite Fallback Initialization
    sqliteDb.exec(`
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

    const checkStmt = sqliteDb.prepare('SELECT device_id FROM devices WHERE device_id = ?');
    const checkDevice = checkStmt.get('ESP32_AUTO_SELADA_01');
    if (!checkDevice) {
      sqliteDb.prepare(`
        INSERT INTO devices (device_id, device_name, location, status)
        VALUES (?, ?, ?, ?)
      `).run('ESP32_AUTO_SELADA_01', 'AUTO-SELADA Unit 1', 'Lahan AA Hidroponik Tempuran Magelang', 'ONLINE');

      sqliteDb.prepare(`
        INSERT INTO device_settings (device_id, ph_min, ph_max, tds_min, tds_max, tds_critical_low, tds_critical_high, dosing_duration_sec, cooldown_duration_sec)
        VALUES (?, 5.5, 6.5, 560, 840, 450, 950, 5, 300)
      `).run('ESP32_AUTO_SELADA_01');

      sqliteDb.prepare(`
        INSERT INTO event_logs (device_id, event_type, state_name, description)
        VALUES (?, 'SYSTEM_INIT', 'NORMAL', 'Initial system initialization for AUTO-SELADA (SQLite)')
      `).run('ESP32_AUTO_SELADA_01');
      console.log('[SQLite] Initial seed data created for ESP32_AUTO_SELADA_01');
    }
  }
}

export default { query, queryOne, initDatabase, isPostgres };
