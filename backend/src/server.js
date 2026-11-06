import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { initDatabase } from './db.js';
import { initMQTT, setBroadcastCallback } from './mqtt.js';
import apiRouter from './routes.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 5000;

// Initialize Database
initDatabase();

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/v1', apiRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'AUTO-SELADA IoT Core Backend',
    timestamp: new Date().toISOString()
  });
});

// Root route (API info & quick navigation)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <title>AUTO-SELADA IoT Backend Service</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; margin: 0; }
        .card { max-width: 800px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 2rem; box-shadow: 0 4px 20px rgba(0,0,0,0.4); border: 1px solid #334155; }
        h1 { color: #22c55e; margin-top: 0; font-size: 1.8rem; }
        p { color: #94a3b8; line-height: 1.6; }
        .badge { background: #14532d; color: #4ade80; padding: 4px 10px; border-radius: 6px; font-size: 0.85rem; font-weight: 600; }
        ul { list-style: none; padding: 0; margin-top: 1.5rem; }
        li { margin-bottom: 0.75rem; background: #0f172a; border-radius: 8px; padding: 10px 14px; border-left: 4px solid #22c55e; display: flex; justify-content: space-between; align-items: center; }
        .method { font-family: monospace; font-weight: bold; color: #38bdf8; margin-right: 10px; }
        a { color: #38bdf8; text-decoration: none; font-family: monospace; }
        a:hover { text-decoration: underline; color: #7dd3fc; }
        .desc { color: #cbd5e1; font-size: 0.9rem; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>🌿 AUTO-SELADA IoT Core Server <span class="badge">ONLINE</span></h1>
        <p>Selamat datang di Backend Service AUTO-SELADA (Sistem Otomatisasi Nutrisi Selada Hidroponik).</p>
        <p>Berikut adalah tautan cepat endpoint API yang bisa Anda klik langsung di browser untuk pengecekan:</p>
        <ul>
          <li>
            <span><span class="method">GET</span> <a href="/health" target="_blank">/health</a></span>
            <span class="desc">Cek status server backend</span>
          </li>
          <li>
            <span><span class="method">GET</span> <a href="/api/v1/devices" target="_blank">/api/v1/devices</a></span>
            <span class="desc">Daftar perangkat terdaftar</span>
          </li>
          <li>
            <span><span class="method">GET</span> <a href="/api/v1/devices/ESP32_AUTO_SELADA_01/telemetry/latest" target="_blank">/api/v1/devices/ESP32_AUTO_SELADA_01/telemetry/latest</a></span>
            <span class="desc">Data sensor dan FSM terkini</span>
          </li>
          <li>
            <span><span class="method">GET</span> <a href="/api/v1/devices/ESP32_AUTO_SELADA_01/telemetry/history?range=24h" target="_blank">/api/v1/devices/ESP32_AUTO_SELADA_01/telemetry/history?range=24h</a></span>
            <span class="desc">Histori data tren 24 jam</span>
          </li>
          <li>
            <span><span class="method">GET</span> <a href="/api/v1/devices/ESP32_AUTO_SELADA_01/events?limit=20" target="_blank">/api/v1/devices/ESP32_AUTO_SELADA_01/events?limit=20</a></span>
            <span class="desc">Audit log riwayat kejadian</span>
          </li>
          <li>
            <span><span class="method">GET</span> <a href="/api/v1/devices/ESP32_AUTO_SELADA_01/settings" target="_blank">/api/v1/devices/ESP32_AUTO_SELADA_01/settings</a></span>
            <span class="desc">Ambang batas (thresholds) pH & TDS</span>
          </li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

// WebSocket Connection handling
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] Client connected. Total active clients: ${wsClients.size}`);

  ws.send(JSON.stringify({
    type: 'CONNECTION_ESTABLISHED',
    message: 'Terhubung ke Real-Time Gateway AUTO-SELADA'
  }));

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] Client disconnected. Total active clients: ${wsClients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
  });
});

// Broadcast helper function
function broadcast(data) {
  const messageStr = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  }
}

// Hook broadcast to MQTT incoming telemetry
setBroadcastCallback((telemetryData) => {
  broadcast(telemetryData);
});

// Initialize MQTT broker connection
initMQTT();

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🌿 AUTO-SELADA Backend Server running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🔗 REST API endpoint: http://localhost:${PORT}/api/v1`);
  console.log(`=======================================================`);
});

