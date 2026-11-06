import express from 'express';
import db from './db.js';
import { sendDeviceCommand, getDeviceRuntimeState, requestDeviceTelemetry } from './mqtt.js';

const router = express.Router();

/**
 * GET /api/v1/devices
 * List all registered hydroponic edge devices
 */
router.get('/devices', (req, res) => {
  try {
    const devices = db.prepare(`
      SELECT devices.*,
        CASE WHEN EXISTS (
          SELECT 1 FROM sensor_logs
          WHERE sensor_logs.device_id = devices.device_id
            AND sensor_logs.created_at >= datetime('now', '-30 seconds')
        ) THEN 'ONLINE' ELSE 'OFFLINE' END AS status
      FROM devices
      ORDER BY created_at DESC
    `).all();
    res.json({ success: true, data: devices });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/devices/:device_id/telemetry/latest
 * Get latest telemetry snapshot for a device
 */
router.get('/devices/:device_id/telemetry/latest', (req, res) => {
  try {
    const { device_id } = req.params;
    const latestSensor = db.prepare(`
      SELECT * FROM sensor_logs
      WHERE device_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `).get(device_id);

    const runtime = getDeviceRuntimeState(device_id);
    const settings = db.prepare('SELECT * FROM device_settings WHERE device_id = ?').get(device_id);

    res.json({
      success: true,
      data: {
        device_id,
        latest_sensor: latestSensor || null,
        runtime_state: runtime,
        settings
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/devices/:device_id/telemetry/sync', (req, res) => {
  try {
    const request = requestDeviceTelemetry(req.params.device_id);
    res.json({ success: true, message: 'Permintaan telemetry dikirim ke perangkat.', data: request });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/devices/:device_id/telemetry/history?range=24h&limit=100
 * SRS 6.2: Mengambil histori data sensor untuk rendering grafik tren di dashboard.
 */
router.get('/devices/:device_id/telemetry/history', (req, res) => {
  try {
    const { device_id } = req.params;
    const { range = '24h', limit = 100 } = req.query;

    let timeFilter = "datetime('now', '-24 hours')";
    if (range === '1h') timeFilter = "datetime('now', '-1 hours')";
    else if (range === '6h') timeFilter = "datetime('now', '-6 hours')";
    else if (range === '12h') timeFilter = "datetime('now', '-12 hours')";
    else if (range === '7d') timeFilter = "datetime('now', '-7 days')";
    else if (range === '30d') timeFilter = "datetime('now', '-30 days')";

    const query = `
      SELECT log_id, device_id, ph_value, tds_ppm, created_at
      FROM sensor_logs
      WHERE device_id = ? AND created_at >= ${timeFilter}
      ORDER BY created_at ASC
      LIMIT ?
    `;

    const records = db.prepare(query).all(device_id, parseInt(limit, 10));

    res.json({
      success: true,
      meta: { device_id, range, count: records.length },
      data: records
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/devices/:device_id/events?limit=50
 * SRS 6.2: Mengambil log riwayat kejadian (Audit Trail Log).
 */
router.get('/devices/:device_id/events', (req, res) => {
  try {
    const { device_id } = req.params;
    const limit = parseInt(req.query.limit, 10) || 50;

    const query = `
      SELECT event_id, device_id, event_type, state_name, description, created_at, raw_payload
      FROM event_logs
      WHERE device_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;

    const logs = db.prepare(query).all(device_id, limit);

    res.json({
      success: true,
      meta: { device_id, count: logs.length },
      data: logs
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/devices/:device_id/stats/daily', (req, res) => {
  try {
    const { device_id } = req.params;
    const dailyCycles = db.prepare(`
      SELECT COUNT(*) AS count
      FROM event_logs
      WHERE device_id = ?
        AND event_type = 'DOSING_START'
        AND date(created_at, 'localtime') = date('now', 'localtime')
    `).get(device_id);
    const runtime = getDeviceRuntimeState(device_id);

    res.json({
      success: true,
      data: {
        pump_cycles: dailyCycles.count,
        cooldown_remaining_seconds: runtime.lockRemainingSeconds,
        cooldown_active: runtime.safetyLock
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/v1/devices/:device_id/settings
 * Get current device threshold configurations
 */
router.get('/devices/:device_id/settings', (req, res) => {
  try {
    const { device_id } = req.params;
    const settings = db.prepare('SELECT * FROM device_settings WHERE device_id = ?').get(device_id);

    if (!settings) {
      return res.status(404).json({ success: false, message: 'Settings not found for this device' });
    }

    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/v1/devices/:device_id/settings
 * SRS 6.2: Mengubah konfigurasi ambang batas (thresholds) secara Over-The-Air (OTA).
 */
router.put('/devices/:device_id/settings', (req, res) => {
  try {
    const { device_id } = req.params;
    const {
      ph_min,
      ph_max,
      tds_min,
      tds_max,
      tds_critical_low,
      tds_critical_high,
      dosing_duration_sec,
      cooldown_duration_sec
    } = req.body;

    // Check existing
    const existing = db.prepare('SELECT * FROM device_settings WHERE device_id = ?').get(device_id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Device not found' });
    }

    const updated = {
      ph_min: ph_min !== undefined ? Number(ph_min) : existing.ph_min,
      ph_max: ph_max !== undefined ? Number(ph_max) : existing.ph_max,
      tds_min: tds_min !== undefined ? parseInt(tds_min, 10) : existing.tds_min,
      tds_max: tds_max !== undefined ? parseInt(tds_max, 10) : existing.tds_max,
      tds_critical_low: tds_critical_low !== undefined ? parseInt(tds_critical_low, 10) : existing.tds_critical_low,
      tds_critical_high: tds_critical_high !== undefined ? parseInt(tds_critical_high, 10) : existing.tds_critical_high,
      dosing_duration_sec: dosing_duration_sec !== undefined ? parseInt(dosing_duration_sec, 10) : existing.dosing_duration_sec,
      cooldown_duration_sec: cooldown_duration_sec !== undefined ? parseInt(cooldown_duration_sec, 10) : existing.cooldown_duration_sec
    };

    db.prepare(`
      UPDATE device_settings
      SET ph_min = ?, ph_max = ?, tds_min = ?, tds_max = ?,
          tds_critical_low = ?, tds_critical_high = ?,
          dosing_duration_sec = ?, cooldown_duration_sec = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE device_id = ?
    `).run(
      updated.ph_min,
      updated.ph_max,
      updated.tds_min,
      updated.tds_max,
      updated.tds_critical_low,
      updated.tds_critical_high,
      updated.dosing_duration_sec,
      updated.cooldown_duration_sec,
      device_id
    );

    // Audit log
    db.prepare(`
      INSERT INTO event_logs (device_id, event_type, state_name, description)
      VALUES (?, 'OTA_SETTINGS_UPDATE', 'CONFIG', ?)
    `).run(device_id, `Pengaturan ambang batas diperbarui via OTA oleh web operator.`);

    res.json({
      success: true,
      message: 'Ambang batas berhasil diperbarui secara OTA.',
      data: updated
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/devices/:device_id/command
 * SRS FR-WB-02 & SRS 6.1: Remote control interlock & pump command
 */
router.post('/devices/:device_id/command', (req, res) => {
  try {
    const { device_id } = req.params;
    const { action = 'TOGGLE_PUMP', state = 'ON', duration_sec = 5, requested_by = 'operator_amanda' } = req.body;

    // Safety Interlock check (FR-WB-02: Hard Lock on Overdose > 950 PPM)
    const latestSensor = db.prepare(`
      SELECT tds_ppm FROM sensor_logs WHERE device_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(device_id);

    const settings = db.prepare('SELECT * FROM device_settings WHERE device_id = ?').get(device_id);
    const tdsCritHigh = settings?.tds_critical_high ?? 950;

    if (latestSensor && latestSensor.tds_ppm > tdsCritHigh) {
      // Record rejected attempt in audit trail
      db.prepare(`
        INSERT INTO event_logs (device_id, event_type, state_name, description)
        VALUES (?, 'OVERDOSE_LOCK', 'DANGER_HIGH_TDS', ?)
      `).run(
        device_id,
        `[CONTROL INTERLOCK] Upaya pengaktifan manual pompa DITOLAK karena kondisi overdosis TDS=${latestSensor.tds_ppm} > ${tdsCritHigh} PPM.`
      );

      return res.status(403).json({
        success: false,
        interlock: true,
        error: 'HARD SAFETY LOCK: Kontrol pompa dinonaktifkan karena overdosis nutrisi (>950 PPM).'
      });
    }

    // Safety Lock cooldown check
    const runtime = getDeviceRuntimeState(device_id);
    if (runtime.safetyLock && runtime.lockRemainingSeconds > 0) {
      return res.status(429).json({
        success: false,
        safety_lock: true,
        remaining_seconds: runtime.lockRemainingSeconds,
        error: `SAFETY LOCK AKTIF: Jeda sirkulasi tandon sedang berlangsung. Sisa ${runtime.lockRemainingSeconds} detik.`
      });
    }

    // Send command via MQTT
    const cmdResult = sendDeviceCommand(device_id, action, state, duration_sec, requested_by);

    res.json({
      success: true,
      message: `Perintah ${action} (${state}) berhasil dikirimkan ke perangkat.`,
      command: cmdResult
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
