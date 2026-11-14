-- Skrip DDL PostgreSQL AUTO-SELADA (SRS Bab 5.1)
-- Dapat dieksekusi di Supabase SQL Editor atau psql client

-- 1. Master Tabel Devices
CREATE TABLE IF NOT EXISTS devices (
    device_id VARCHAR(50) PRIMARY KEY,
    device_name VARCHAR(100) NOT NULL,
    location VARCHAR(100) DEFAULT 'Lahan AA Hidroponik Tempuran',
    status VARCHAR(20) DEFAULT 'OFFLINE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabel Telemetri Sensor (High-Volume Data)
CREATE TABLE IF NOT EXISTS sensor_logs (
    log_id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    ph_value DECIMAL(4,2) NOT NULL,
    tds_ppm INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sensor_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sensor_telemetry ON sensor_logs (device_id, created_at DESC);

-- 3. Tabel Event Logs (Audit Trail Events)
CREATE TABLE IF NOT EXISTS event_logs (
    event_id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL,
    event_type VARCHAR(30) NOT NULL, -- STATE_CHANGE, DOSING_START, SAFETY_LOCK, OVERDOSE_LOCK, pH_ALERT
    state_name VARCHAR(20) NOT NULL, -- NORMAL, SIAGA, DANGER_LOW_TDS, DANGER_HIGH_TDS, DANGER_PH
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_event_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_logs (device_id, created_at DESC);

-- 4. Tabel Configuration & Threshold Settings
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
    CONSTRAINT fk_settings_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- Seed Data Initial Setup Perangkat Capstone
INSERT INTO devices (device_id, device_name, location, status)
VALUES ('ESP32_AUTO_SELADA_01', 'AUTO-SELADA Unit 1', 'Lahan AA Hidroponik Tempuran Magelang', 'ONLINE')
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO device_settings (device_id)
VALUES ('ESP32_AUTO_SELADA_01')
ON CONFLICT (device_id) DO NOTHING;

