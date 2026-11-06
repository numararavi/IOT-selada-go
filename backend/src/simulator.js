/**
 * AUTO-SELADA Hardware Edge Simulator (ESP32 / Arduino Digital Twin)
 * Simulates real sensor acquisition, moving average filter, dosing logic,
 * safety cooldown (300s), and MQTT publishing according to SRS specification.
 */
import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://broker.emqx.io:1883';
const deviceId = 'ESP32_AUTO_SELADA_01';
const telemetryTopic = `hydroponic/v1/devices/${deviceId}/telemetry`;
const commandTopic = `hydroponic/v1/devices/${deviceId}/command`;
const telemetryRequestTopic = `hydroponic/v1/devices/${deviceId}/telemetry/request`;

console.log(`[Simulator] Starting Digital Twin for ${deviceId}...`);
const client = mqtt.connect(brokerUrl);

// Simulated physical state
let currentPh = 6.20;
let currentTds = 720;
let pumpRelay = false;
let safetyLock = false;
let lockRemainingSeconds = 0;
let dosingTimer = null;
let cooldownInterval = null;

// Moving average buffer simulation (N=10)
const phBuffer = Array(10).fill(currentPh);
const tdsBuffer = Array(10).fill(currentTds);

client.on('connect', () => {
  console.log(`[Simulator] Connected to broker: ${brokerUrl}`);
  client.subscribe(commandTopic, (err) => {
    if (!err) console.log(`[Simulator] Subscribed to command topic: ${commandTopic}`);
  });
  client.subscribe(telemetryRequestTopic, (err) => {
    if (!err) console.log(`[Simulator] Subscribed to telemetry request topic: ${telemetryRequestTopic}`);
  });

  // Start periodic telemetry reporting (every 2 seconds as per FR-HW-01)
  setInterval(publishTelemetry, 2000);
});

client.on('message', (topic, message) => {
  if (topic === telemetryRequestTopic) {
    publishTelemetry();
    return;
  }

  if (topic === commandTopic) {
    try {
      const cmd = JSON.parse(message.toString());
      console.log(`[Simulator] 📥 Received Command:`, cmd);

      if (cmd.action === 'TOGGLE_PUMP') {
        if (currentTds > 950) {
          console.log(`[Simulator] ⛔ HARD LOCK: Rejecting command because TDS > 950 PPM`);
          return;
        }

        if (cmd.state === 'ON') {
          triggerDosing(cmd.duration_sec || 5);
        } else {
          stopDosing();
        }
      }
    } catch (err) {
      console.error(`[Simulator] Error parsing command:`, err.message);
    }
  }
});

function triggerDosing(durationSec = 5) {
  if (safetyLock) {
    console.log(`[Simulator] ⏳ Safety Lock active. Cannot run pump now.`);
    return;
  }

  pumpRelay = true;
  console.log(`[Simulator] 💦 Pump ACTIVATED for ${durationSec} seconds! Injeksi nutrisi AB Mix...`);

  clearTimeout(dosingTimer);
  dosingTimer = setTimeout(() => {
    pumpRelay = false;
    safetyLock = true;
    lockRemainingSeconds = 300; // 5 minutes safety lock as per SRS
    console.log(`[Simulator] 🛑 Pump STOPPED. Entering Safety Lock for 300s...`);

    // Dosing adds TDS
    currentTds = Math.min(980, currentTds + 180);

    clearInterval(cooldownInterval);
    cooldownInterval = setInterval(() => {
      lockRemainingSeconds--;
      if (lockRemainingSeconds <= 0) {
        safetyLock = false;
        clearInterval(cooldownInterval);
        console.log(`[Simulator] 🔓 Safety Lock period ended. Normal sensing resumes.`);
      }
    }, 1000);
  }, durationSec * 1000);
}

function stopDosing() {
  pumpRelay = false;
  clearTimeout(dosingTimer);
}

function getSystemState(ph, tds) {
  if (tds < 450) return 'DANGER_LOW_TDS';
  if (tds > 950) return 'DANGER_HIGH_TDS';
  if (ph < 5.0 || ph > 7.0) return 'DANGER_PH';
  if ((ph >= 5.0 && ph < 5.5) || (ph > 6.5 && ph <= 7.0) || (tds >= 450 && tds < 560) || (tds > 840 && tds <= 950)) {
    return 'SIAGA';
  }
  return 'NORMAL';
}

function publishTelemetry() {
  // Apply minor realistic fluctuations
  const phJitter = (Math.random() - 0.5) * 0.04;
  const tdsJitter = (Math.random() - 0.5) * 4;

  let rawPh = +(currentPh + phJitter).toFixed(2);
  let rawTds = Math.round(currentTds + tdsJitter);

  // Moving Average Filter (N=10)
  phBuffer.shift();
  phBuffer.push(rawPh);
  tdsBuffer.shift();
  tdsBuffer.push(rawTds);

  const avgPh = +(phBuffer.reduce((a, b) => a + b, 0) / 10).toFixed(2);
  const avgTds = Math.round(tdsBuffer.reduce((a, b) => a + b, 0) / 10);

  // Auto dosing check (FR-HW-02: Saat TDS < 450 PPM, relay wajib menyalakan pompa 5s)
  if (avgTds < 450 && !pumpRelay && !safetyLock) {
    console.log(`[Simulator] ⚠️ TDS is below 450 PPM (${avgTds} PPM). Triggering auto-dosing!`);
    triggerDosing(5);
  }

  const systemState = getSystemState(avgPh, avgTds);

  const payload = {
    device_id: deviceId,
    timestamp: Math.floor(Date.now() / 1000),
    metrics: {
      ph: avgPh,
      tds_ppm: avgTds
    },
    system_state: systemState,
    actuators: {
      relay_pump: pumpRelay,
      safety_lock: safetyLock,
      lock_remaining_seconds: lockRemainingSeconds
    }
  };

  client.publish(telemetryTopic, JSON.stringify(payload), { qos: 1 });
  console.log(`[Simulator] 📤 Telemetry sent -> pH: ${avgPh} | TDS: ${avgTds} PPM | State: ${systemState} | Pump: ${pumpRelay} | Lock: ${safetyLock} (${lockRemainingSeconds}s)`);
}
