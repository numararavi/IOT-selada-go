import mqtt from 'mqtt';
import db from './db.js';
import { evaluateFSM } from './fsm.js';

let mqttClient = null;
let broadcastCallback = null;

// Keep track of active device runtime state
const deviceRuntimeState = new Map();

export function getDeviceRuntimeState(deviceId) {
  if (!deviceRuntimeState.has(deviceId)) {
    deviceRuntimeState.set(deviceId, {
      lastState: 'NORMAL',
      lastTelemetry: null,
      dosingActive: false,
      safetyLock: false,
      lockRemainingSeconds: 0,
      dosingStreak: 0,
      fault: null
    });
  }
  return deviceRuntimeState.get(deviceId);
}

export function setBroadcastCallback(cb) {
  broadcastCallback = cb;
}

export function initMQTT(brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://broker.emqx.io:1883') {
  console.log(`[MQTT] Connecting to broker at ${brokerUrl}...`);
  mqttClient = mqtt.connect(brokerUrl, {
    clientId: `auto_selada_backend_${Math.random().toString(16).slice(2, 8)}`,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 3000
  });

  mqttClient.on('connect', () => {
    console.log('[MQTT] Connected successfully to broker.');
    // Subscribe to telemetry from all hydroponic devices
    const topic = 'hydroponic/v1/devices/+/telemetry';
    mqttClient.subscribe(topic, { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscription error:', err);
      else console.log(`[MQTT] Subscribed to ${topic}`);
    });
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] Connection error:', err.message);
  });

  mqttClient.on('message', (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      handleTelemetryMessage(topic, payload);
    } catch (err) {
      console.error('[MQTT] Failed to parse message JSON:', err.message);
    }
  });

  return mqttClient;
}

export function handleTelemetryMessage(topic, payload) {
  const deviceId = payload.device_id;
  if (!deviceId || !payload.metrics) return;

  const ph = Number(payload.metrics.ph);
  const tds = Number(payload.metrics.tds_ppm);
  const rawTimestamp = payload.timestamp ? new Date(payload.timestamp * 1000).toISOString() : new Date().toISOString();

  // Load device threshold settings
  const settings = db.prepare('SELECT * FROM device_settings WHERE device_id = ?').get(deviceId);
  const fsmResult = evaluateFSM(ph, tds, settings);

  // Update or insert device status
  db.prepare(`
    INSERT INTO devices (device_id, device_name, status, updated_at)
    VALUES (?, ?, 'ONLINE', CURRENT_TIMESTAMP)
    ON CONFLICT(device_id) DO UPDATE SET status = 'ONLINE', updated_at = CURRENT_TIMESTAMP
  `).run(deviceId, deviceId);

  // Insert into sensor_logs
  db.prepare(`
    INSERT INTO sensor_logs (device_id, ph_value, tds_ppm, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `).run(deviceId, ph, tds);

  // Check state transitions for audit log
  const runtime = getDeviceRuntimeState(deviceId);
  runtime.lastTelemetry = {
    ...payload,
    computed_state: fsmResult
  };

  if (runtime.lastState !== fsmResult.state) {
    db.prepare(`
      INSERT INTO event_logs (device_id, event_type, state_name, description)
      VALUES (?, 'STATE_CHANGE', ?, ?)
    `).run(
      deviceId,
      fsmResult.state,
      `Transisi kondisi sistem dari ${runtime.lastState} menjadi ${fsmResult.state}. Nilai: pH=${ph}, TDS=${tds} PPM.`
    );
    runtime.lastState = fsmResult.state;
  }

  // Actuator reflection
  if (payload.actuators) {
    runtime.dosingActive = !!payload.actuators.relay_pump;
    runtime.safetyLock = !!payload.actuators.safety_lock;
    runtime.lockRemainingSeconds = payload.actuators.lock_remaining_seconds || 0;
  }

  // Broadcast to WebSockets for live dashboard update (< 1.5s latency)
  if (broadcastCallback) {
    broadcastCallback({
      type: 'TELEMETRY_UPDATE',
      deviceId,
      data: {
        timestamp: rawTimestamp,
        metrics: { ph, tds_ppm: tds },
        system_state: fsmResult.state,
        fsm: fsmResult,
        actuators: {
          relay_pump: runtime.dosingActive,
          safety_lock: runtime.safetyLock,
          lock_remaining_seconds: runtime.lockRemainingSeconds
        }
      }
    });
  }
}

/**
 * Sends command down to device via MQTT (Topic: hydroponic/v1/devices/{device_id}/command)
 */
export function sendDeviceCommand(deviceId, action, state, durationSec = 5, requestedBy = 'dashboard_operator') {
  if (!mqttClient || !mqttClient.connected) {
    throw new Error('MQTT broker is not connected');
  }

  const topic = `hydroponic/v1/devices/${deviceId}/command`;
  const commandPayload = {
    command_id: `cmd_${Date.now()}`,
    action,
    state,
    duration_sec: durationSec,
    requested_by: requestedBy
  };

  mqttClient.publish(topic, JSON.stringify(commandPayload), { qos: 1 });

  // Log command event
  db.prepare(`
    INSERT INTO event_logs (device_id, event_type, state_name, description)
    VALUES (?, 'COMMAND_SENT', 'CONTROL', ?)
  `).run(deviceId, `Perintah dikirim: ${action} (${state}) selama ${durationSec} detik oleh ${requestedBy}`);

  return commandPayload;
}

