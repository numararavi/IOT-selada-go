# Backend AUTO-SELADA (IoT Lettuce Hydroponic Automation)

Backend RESTful API, MQTT Broker Gateway, WebSocket Real-time, dan Engine Finite State Machine (FSM) yang dibangun berdasarkan dokumen spesifikasi **SRS-AUTO-SELADA-2026 Versi 2.0**.

## Fitur Utama
1. **MQTT Telemetry Ingestion (QoS 1)**: Menerima data stream dari ESP32 di lahan melalui topic `hydroponic/v1/devices/{device_id}/telemetry`.
2. **Real-Time WebSocket Gateway**: Mendorong update telemetri ke Frontend dengan latensi `< 1.5s`.
3. **Finite State Machine (FSM)**:
   - `NORMAL`: pH 5.5 - 6.5 & TDS 560 - 840 PPM ("SELADA HAPPY 🥬")
   - `SIAGA`: Peringatan awal parameter bergeser
   - `DANGER_LOW_TDS`: TDS < 450 PPM (Auto Dosing 5 detik + Safety Lock 300 detik)
   - `DANGER_HIGH_TDS`: TDS > 950 PPM (Hard Lock pencegah overdosis)
   - `DANGER_PH`: pH < 5.0 atau > 7.0 dengan rekomendasi Smart Guidance (pH Up / pH Down)
4. **Safety & Hard Control Interlock**: Tombol manual web terkunci jika TDS > 950 PPM atau sedang masa sirkulasi (cooldown 300s).
5. **Audit Trail & Logging**: Mencatat riwayat log event, transisi FSM, dan interaksi kontrol.
6. **Built-in Digital Twin Simulator**: Simulator hardware edge untuk pengujian tanpa ESP32 fisik.

---

## Menjalankan Backend

### 1. Jalankan Server Utama
```bash
npm run dev
# atau
npm start
```
Server berjalan di `http://localhost:5000` (REST API & WebSockets `ws://localhost:5000`).

### 2. Jalankan Simulator ESP32 (Opsional / Testing)
```bash
npm run simulate
```

---

## Daftar Endpoint RESTful API

| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/health` | Status server backend |
| `GET` | `/api/v1/devices` | Daftar edge device terdaftar |
| `GET` | `/api/v1/devices/:device_id/telemetry/latest` | Snapshot telemetri, FSM, dan aktuator terkini |
| `GET` | `/api/v1/devices/:device_id/telemetry/history?range=24h` | Data time series untuk grafik tren |
| `GET` | `/api/v1/devices/:device_id/events?limit=50` | Audit trail riwayat log kejadian |
| `GET` | `/api/v1/devices/:device_id/settings` | Konfigurasi ambang batas parameter |
| `PUT` | `/api/v1/devices/:device_id/settings` | Pembaruan ambang batas secara OTA |
| `POST`| `/api/v1/devices/:device_id/command` | Pengiriman instruksi aktuator pompa ke edge device |

