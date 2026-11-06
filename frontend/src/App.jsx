import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Droplet,
  ExternalLink,
  FlaskConical,
  Leaf,
  LockKeyhole,
  Menu,
  Play,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sprout,
  Timer,
  Wifi,
  X,
} from 'lucide-react'
import { Line } from 'react-chartjs-2'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import './App.css'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
)

const timeRanges = ['1 jam', '6 jam', '24 jam', '7 hari']
const deviceId = 'ESP32_AUTO_SELADA_01'

async function fetchApi(path, options) {
  const response = await fetch(`/api/v1${path}`, options)
  const result = await response.json()
  if (!response.ok || result.success === false) {
    throw new Error(result.error || result.message || `Permintaan gagal (${response.status})`)
  }
  return result
}

function App() {
  const [selectedDose, setSelectedDose] = useState('25 ml')
  const [isCirculating, setIsCirculating] = useState(false)
  const [isEmergency, setIsEmergency] = useState(false)
  const [timeRange, setTimeRange] = useState('24 jam')
  const [search, setSearch] = useState('')
  const [eventFilter, setEventFilter] = useState('Semua Event')
  const [page, setPage] = useState(1)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [telemetry, setTelemetry] = useState(null)
  const [device, setDevice] = useState(null)
  const [dailyStats, setDailyStats] = useState(null)
  const [events, setEvents] = useState([])
  const [sensorHistory, setSensorHistory] = useState([])
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [apiError, setApiError] = useState('')

  const refreshDashboard = useCallback(async () => {
    setLoading(true)
    setApiError('')
    try {
      const range = { '1 jam': '1h', '6 jam': '6h', '24 jam': '24h', '7 hari': '7d' }[timeRange]
      const [latestResult, devicesResult, eventsResult, statsResult, historyResult] = await Promise.all([
        fetchApi(`/devices/${deviceId}/telemetry/latest`),
        fetchApi('/devices'),
        fetchApi(`/devices/${deviceId}/events?limit=100`),
        fetchApi(`/devices/${deviceId}/stats/daily`),
        fetchApi(`/devices/${deviceId}/telemetry/history?range=${range}&limit=200`),
      ])
      setTelemetry(latestResult.data)
      setDevice(devicesResult.data.find((item) => item.device_id === deviceId) || null)
      setDailyStats(statsResult.data)
      setEvents(eventsResult.data.map((event) => ({
        time: new Date(event.created_at + 'Z').toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
        type: event.event_type,
        tone: event.event_type.includes('ALERT') || event.event_type.includes('LOCK') ? 'yellow' : 'green',
        name: event.state_name,
        description: event.description || '-',
        rawPayload: event.raw_payload ? JSON.parse(event.raw_payload) : {
          event_id: event.event_id,
          device_id: event.device_id,
          event_type: event.event_type,
          state_name: event.state_name,
          description: event.description,
          created_at: event.created_at,
          note: 'Payload telemetry mentah tidak tersimpan untuk event ini.',
        },
      })))
      setSensorHistory(historyResult.data)
    } catch (error) {
      setApiError(error.message)
    } finally {
      setLoading(false)
    }
  }, [timeRange])

  useEffect(() => {
    const initialLoad = window.setTimeout(refreshDashboard, 0)
    const timer = window.setInterval(refreshDashboard, 10000)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(timer)
    }
  }, [refreshDashboard])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') setModal(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function syncTelemetry() {
    setSyncMessage('')
    try {
      await fetchApi(`/devices/${deviceId}/telemetry/sync`, { method: 'POST' })
      setSyncMessage('Permintaan dikirim; menunggu data terbaru dari perangkat.')
      await refreshDashboard()
    } catch (error) {
      setApiError(error.message)
    }
  }

  const filteredEvents = useMemo(() => events.filter((event) => {
    const matchesSearch = `${event.time} ${event.type} ${event.name} ${event.description}`
      .toLowerCase()
      .includes(search.toLowerCase())
    const matchesFilter = eventFilter === 'Semua Event' || event.type === eventFilter
    return matchesSearch && matchesFilter
  }), [eventFilter, search, events])

  const visibleEvents = filteredEvents.slice((page - 1) * 5, page * 5)
  const pageCount = Math.max(1, Math.ceil(filteredEvents.length / 5))
  const latestSensor = telemetry?.latest_sensor
  const latestPayload = telemetry?.runtime_state?.lastTelemetry
  const deviceInfo = latestPayload?.device_info || latestPayload || {}
  const online = Boolean(device?.status === 'ONLINE' && latestSensor)
  const phValue = Number(latestSensor?.ph_value)
  const tdsValue = Number(latestSensor?.tds_ppm)
  const phStatus = latestSensor
    ? phValue < (telemetry.settings?.ph_min ?? 5.5) || phValue > (telemetry.settings?.ph_max ?? 6.5) ? 'PERIKSA' : 'NORMAL'
    : 'NO DATA'
  const tdsStatus = latestSensor
    ? tdsValue < (telemetry.settings?.tds_min ?? 560) || tdsValue > (telemetry.settings?.tds_max ?? 840) ? 'PERIKSA' : 'VEGETATIF'
    : 'NO DATA'

  function hourlyTrend(key, decimals = 2) {
    if (sensorHistory.length < 2) return 'Data belum cukup'
    const previous = sensorHistory[sensorHistory.length - 2]
    const current = sensorHistory[sensorHistory.length - 1]
    const elapsedHours = (new Date(`${current.created_at}Z`) - new Date(`${previous.created_at}Z`)) / 3600000
    if (elapsedHours <= 0) return 'Data belum cukup'
    const change = (Number(current[key]) - Number(previous[key])) / elapsedHours
    return `${change > 0 ? '+' : ''}${change.toFixed(decimals)} /jam`
  }

  const chartData = useMemo(() => {
    const labels = sensorHistory.map((record) => new Date(record.created_at + 'Z')
      .toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }))
    return {
      labels,
      datasets: [
        {
          label: 'Tingkat Keasaman (pH)',
          data: sensorHistory.map((record) => record.ph_value),
          yAxisID: 'y',
          borderColor: '#07805f',
          backgroundColor: 'rgba(0, 128, 93, 0.1)',
          fill: true,
          tension: 0.38,
          pointRadius: labels.length > 30 ? 0 : 2,
          pointHoverRadius: 5,
          pointBackgroundColor: '#07805f',
          borderWidth: 2,
        },
        {
          label: 'Kepadatan TDS (PPM)',
          data: sensorHistory.map((record) => record.tds_ppm),
          yAxisID: 'yPpm',
          borderColor: '#008bd2',
          backgroundColor: 'rgba(0, 139, 210, 0.08)',
          fill: true,
          tension: 0.38,
          pointRadius: labels.length > 30 ? 0 : 2,
          pointHoverRadius: 5,
          pointBackgroundColor: '#008bd2',
          borderWidth: 2,
        },
        {
          label: 'Interlock Cut-Off (950 PPM)',
          data: labels.map(() => 950),
          yAxisID: 'yPpm',
          borderColor: '#f14e4e',
          borderDash: [5, 5],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false,
        },
      ],
    }
  }, [sensorHistory])

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#fff',
        titleColor: '#182331',
        bodyColor: '#516173',
        borderColor: '#e5ebef',
        borderWidth: 1,
        padding: 10,
        displayColors: true,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: '#8795a5', font: { size: 10 }, maxRotation: 0 },
      },
      y: {
        min: 5,
        max: 7,
        position: 'left',
        border: { display: false },
        grid: { color: '#edf1f3', borderDash: [2, 4] },
        ticks: { stepSize: 0.5, color: '#8795a5', font: { size: 10 } },
      },
      yPpm: {
        min: 400,
        max: 1000,
        position: 'right',
        border: { display: false },
        grid: { drawOnChartArea: false },
        ticks: { stepSize: 150, color: '#8795a5', font: { size: 10 } },
      },
    },
  }), [])

  function downloadLog() {
    const rows = [
      ['Timestamp', 'Event Type', 'State Name', 'Description'],
      ...filteredEvents.map((event) => [event.time, event.type, event.name, event.description]),
    ]
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'selada-audit-log.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#overview" aria-label="AUTO-SELADA beranda">
          <span className="brand-mark"><Leaf size={17} /></span>
          <span className="brand-copy">
            <strong>AUTO-SELADA</strong>
            <small>Smart Hydroponic Automation</small>
          </span>
        </a>
        <button
          className="mobile-menu-toggle"
          type="button"
          aria-label="Buka navigasi"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <Menu size={19} />
        </button>
        <nav className={`main-nav ${mobileMenuOpen ? 'is-open' : ''}`} aria-label="Navigasi utama">
          <a href="#overview" onClick={() => setMobileMenuOpen(false)}>Ringkasan</a>
          <a href="#metrics" onClick={() => setMobileMenuOpen(false)}>Metrik</a>
          <a href="#control" onClick={() => setMobileMenuOpen(false)}>Kendali Pompa</a>
          <a href="#chart" onClick={() => setMobileMenuOpen(false)}>Grafik Tren</a>
          <a href="#agronomy" onClick={() => setMobileMenuOpen(false)}>SOP Agronomi</a>
          <a href="#audit" onClick={() => setMobileMenuOpen(false)}>Audit Log</a>
        </nav>
        <button className="device-status" type="button" onClick={() => setModal({ type: 'device' })}>
          <span className={`online-dot ${online ? '' : 'offline-dot'}`} />
          <span><strong>ESP32</strong><small>{online ? 'Online' : 'Offline / belum ada data'}</small></span>
          <span className="signal">{deviceInfo.wifi_rssi_dbm ?? deviceInfo.rssi_dbm ?? 'RSSI belum tersedia'}</span>
        </button>
      </header>

      <main className="dashboard">
        <section className={`hero-banner ${isEmergency ? 'hero-emergency' : ''}`} id="overview">
          <div className="hero-main">
            <div className="system-pill"><Activity size={12} /> {loading ? 'MEMUAT TELEMETRI' : online ? 'PERANGKAT TERHUBUNG' : 'MENUNGGU TELEMETRI'} <span>•</span> Pembaruan otomatis tiap 10 detik <span>•</span> Node: {deviceId}</div>
            <h1>STATUS: {isEmergency ? 'EMERGENCY STOP' : telemetry?.runtime_state?.lastState || 'MENUNGGU DATA'} — SELADA <span aria-hidden="true">🥬</span></h1>
            <p>{latestSensor ? `Pembacaan terbaru: pH ${Number(latestSensor.ph_value).toFixed(2)} dan TDS ${latestSensor.tds_ppm} PPM. Status sistem ${telemetry?.runtime_state?.lastState || 'belum diketahui'}.` : 'Belum ada data sensor yang diterima. Pastikan backend, broker MQTT, dan perangkat ESP32 aktif.'}<br className="desktop-break" /> Data diperbarui otomatis saat telemetry perangkat tersedia.</p>
          </div>
          <div className="hero-details">
            <span className="detail-badge"><span className={`online-dot ${online ? '' : 'offline-dot'}`} /> {online ? 'ESP32 ONLINE' : 'ESP32 OFFLINE'}</span>
            <span className="detail-row"><Sprout size={13} /> Lahan AA Tempuran,<br /> Magelang</span>
            <span className="detail-row"><Clock3 size={13} /> Update: {latestSensor ? new Date(`${latestSensor.created_at}Z`).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'Belum ada data'}</span>
            <button className="detail-row sync-button" type="button" onClick={syncTelemetry} disabled={loading}><Wifi size={13} /> {loading ? 'Menyinkronkan...' : 'Sync Telemetry'}</button>
            {syncMessage && <small className="sync-feedback">{syncMessage}</small>}
          </div>
        </section>

        <section className="metrics-section" id="metrics">
          <div className="section-heading">
            <div><h2>Metrik Telemetri Utama</h2><p>Nilai sensor langsung dari kolam nutrisi hidroponik NFT</p></div>
            <span className="outline-tag">Resolusi 16-Bit ADC</span>
          </div>
          <div className="metric-grid">
            <article className="metric-card interactive-card" role="button" tabIndex={0} aria-label="Buka histori kalibrasi sensor pH" onClick={() => setModal({ type: 'calibration', sensor: 'pH' })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setModal({ type: 'calibration', sensor: 'pH' }) }}>
              <div className="metric-card-head"><span className="metric-icon mint"><FlaskConical size={17} /></span><span className="metric-name">KEASAMAN (pH)</span><span className={`status-tag ${phStatus === 'NORMAL' ? 'green' : 'gray'}`}>{phStatus}</span></div>
              <div className="metric-value">{latestSensor ? Number(latestSensor.ph_value).toFixed(2) : '—'} <small>pH</small></div>
              <div className="range-track"><span className="range-fill ph-fill" /><i className="range-marker ph-marker" /></div>
              <div className="range-labels"><span>Min {telemetry?.settings?.ph_min ?? 5.5}</span><span>Max {telemetry?.settings?.ph_max ?? 6.5}</span></div>
              <div className="metric-foot"><span>Tren:</span><strong>{hourlyTrend('ph_value')}</strong></div>
            </article>
            <article className="metric-card interactive-card" role="button" tabIndex={0} aria-label="Buka histori kalibrasi sensor TDS" onClick={() => setModal({ type: 'calibration', sensor: 'TDS' })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setModal({ type: 'calibration', sensor: 'TDS' }) }}>
              <div className="metric-card-head"><span className="metric-icon blue"><Droplet size={17} /></span><span className="metric-name">NUTRISI TDS</span><span className={`status-tag ${tdsStatus === 'VEGETATIF' ? 'blue-tag' : 'gray'}`}>{tdsStatus}</span></div>
              <div className="metric-value blue-value">{latestSensor?.tds_ppm ?? '—'} <small>PPM</small></div>
              <div className="range-track"><span className="range-fill tds-fill" /><i className="range-marker tds-marker" /></div>
              <div className="range-labels"><span>{telemetry?.settings?.tds_min ?? 560}</span><span>{telemetry?.settings?.tds_max ?? 840} PPM</span></div>
              <div className="metric-foot"><span>Tren:</span><strong className="blue-text">{hourlyTrend('tds_ppm', 1)}</strong></div>
            </article>
            <article className="metric-card timer-card interactive-card" role="button" tabIndex={0} aria-label="Buka rincian siklus pemompaan harian" onClick={() => setModal({ type: 'cooldown' })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setModal({ type: 'cooldown' }) }}>
              <div className="metric-card-head"><span className="metric-icon gray"><Timer size={17} /></span><span className="metric-name">TIMER COOLDOWN &amp; DOSIS</span><span className={`status-tag ${dailyStats?.cooldown_active ? 'blue-tag' : 'green'}`}>{dailyStats ? dailyStats.cooldown_active ? 'COOLDOWN' : 'STANDBY' : 'NO DATA'}</span></div>
              <div className="metric-value timer-value">{dailyStats?.cooldown_remaining_seconds ?? '—'}s JEDA</div>
              <p className="metric-subtext">Cooldown dosis otomatis (konfigurasi 5 menit)</p>
              <div className="cooldown-row"><span>Siklus pemompaan hari ini:</span><strong>{dailyStats?.pump_cycles ?? '—'}</strong></div>
            </article>
          </div>
        </section>

        <section className="control-panel panel" id="control">
          <div className="panel-heading control-heading">
            <div className="panel-title-group">
              <span className="panel-icon"><SlidersHorizontal size={18} /></span>
              <div><h2>Pusat Kendali Pompa, Nutrisi &amp; Relai</h2><p>Manajemen injeksi dosis nutrisi AB-Mix dan siklus pompa sirkulasi hidroponik NFT</p></div>
            </div>
            <div className="control-actions">
              <button className={`emergency-button ${isEmergency ? 'active' : ''}`} type="button" onClick={() => setIsEmergency(!isEmergency)}>
                {isEmergency ? <CheckCircle2 size={13} /> : <X size={13} />} {isEmergency ? 'Mulai Ulang' : <>Emergency<br />Stop</>}
              </button>
              <span className="interlock-chip"><span className="online-dot" /> INTERLOCK: TERBUKA<br />(AMAN)</span>
              <small>Auto-Lockout: &gt;950 PPM</small>
            </div>
          </div>

          <div className="control-content">
            <div className="dose-control">
              <h3>PILIHAN VOLUME INJEKSI DOSIS NUTRISI:</h3>
              <div className="dose-options">
                {[
                  { volume: '10 ml', caption: 'Mikro Adjust' },
                  { volume: '25 ml', caption: 'Standar (5s)' },
                  { volume: '50 ml', caption: 'Koreksi Tandon' },
                ].map((dose) => (
                  <button
                    className={`dose-option ${selectedDose === dose.volume ? 'selected' : ''}`}
                    key={dose.volume}
                    type="button"
                    aria-pressed={selectedDose === dose.volume}
                    onClick={() => setSelectedDose(dose.volume)}
                  >
                    <span>{dose.volume}<i className="radio-mark">{selectedDose === dose.volume && <Check size={11} />}</i></span>
                    <small>{dose.caption}</small>
                  </button>
                ))}
              </div>
              <div className="control-buttons">
                <button className="primary-button" type="button" disabled={isEmergency} onClick={() => window.alert(`Dosis nutrisi ${selectedDose} berhasil dipicu.`)}><Play size={14} fill="currentColor" /> Pemicu Dosis Nutrisi (5s)</button>
                <button className={`secondary-button ${isCirculating ? 'running' : ''}`} type="button" disabled={isEmergency} onClick={() => setIsCirculating(!isCirculating)}><RotateCw size={14} /> {isCirculating ? 'Hentikan Sirkulasi' : 'Sirkulasi & Penyiraman (30s)'}</button>
              </div>
              <div className="safety-note"><LockKeyhole size={14} /><span><strong>Proteksi Interlock Peristaltik:</strong> Tombol injeksi terkunci otomatis oleh firmware ESP32 jika TDS melebihi 950 PPM demi mencegah busuk akar akibat akumulasi garam mineral.</span></div>
            </div>

            <aside className="relay-status">
              <div className="relay-title"><h3>STATUS RELAI AKTUATOR ESP32</h3><span>12V DC Supply: NORMAL</span></div>
              <div className="relay-row"><span className="relay-dot green-dot" /><div><strong>Relay 1: Pompa Dosis AB-Mix</strong><small>Peristaltik 12V DC (450 ml/min)</small></div><span className="relay-state ready">READY</span></div>
              <div className="relay-row"><span className="relay-dot blue-dot" /><div><strong>Relay 2: Sirkulasi &amp; Siram NFT</strong><small>Submersible Pump 220V AC</small></div><span className={`relay-state ${isCirculating ? 'cycling' : 'ready'}`}>{isCirculating ? 'CYCLING ACTIVE' : 'READY'}</span></div>
              <div className="relay-row"><span className="relay-dot gray-dot" /><div><strong>Relay 3: Solenoid Air Baku</strong><small>Pengisian tandon otomatis</small></div><span className="relay-state standby">STANDBY</span></div>
              <div className="relay-foot"><span>Total Eksekusi Hari Ini: <strong>24 Siklus</strong></span><span>Interlock Response: <strong>&lt;20 ms</strong></span></div>
            </aside>
          </div>
        </section>

        <section className="chart-panel panel" id="chart">
          <div className="panel-heading chart-heading">
            <div><h2>Grafik Dinamika Nutrisi &amp; pH 24 Jam (Live Feed)</h2><p>Visualisasi keseimbangan ion larutan vs penyerapan akar selada secara simultan</p></div>
            <div className="range-switch" role="group" aria-label="Rentang waktu grafik">
              {timeRanges.map((range) => (
                <button className={timeRange === range ? 'active' : ''} key={range} type="button" onClick={() => setTimeRange(range)}>{range.split(' ')[0]}<small>{range.split(' ')[1]}</small></button>
              ))}
            </div>
          </div>
          <div className="chart-container"><Line data={chartData} options={chartOptions} /></div>
          <div className="chart-footer">
            <div className="legend-items"><span><i className="legend-dot green-dot" /> Tingkat Keasaman ({latestSensor ? Number(latestSensor.ph_value).toFixed(2) : '—'} pH)</span><span><i className="legend-dot blue-dot" /> Kepekatan TDS ({latestSensor?.tds_ppm ?? '—'} PPM)</span><span><i className="legend-line" /> Interlock Cut-Off (950 PPM)</span></div>
            <span>Frekuensi data sesuai telemetry perangkat • MQTT</span>
          </div>
        </section>

        <section className="agronomy-panel panel" id="agronomy">
          <div className="panel-heading agronomy-heading">
            <div className="panel-title-group">
              <span className="panel-icon mint"><Sprout size={18} /></span>
              <div><h2>Smart Field Solution Box &amp; Panduan Agronomi</h2><p>Logika penanganan otomatis terenkripsi mikrokontroler edge computing</p></div>
            </div>
            <span className="guidance-status"><span className="online-dot" /> AUTO-GUIDANCE ACTIVE</span>
          </div>
          <div className="stable-note"><CheckCircle2 size={16} /><div><strong>Kondisi Kolam Sangat Stabil — Selada Vegetatif Prima</strong><p>Parameter larutan nutrisi berada tepat di target vegetatif ideal tanaman selada. Tidak diperlukan intervensi manual. Siklus sirkulasi oksigen berjalan dan dosing terjadwal berjalan secara presisi.</p></div></div>
          <div className="alert-grid">
            <article className="alert-card warning"><div><strong>LOW TDS (&lt;450 PPM)</strong><AlertTriangle size={13} /></div><h3>NUTRISI DROP: <span>ESP32 menginjeksikan 25ml pupuk AB-Mix (durasi 5s). Sistem mengaktifkan jeda sirkulasi 5 menit sebelum pembacaan ulang.</span></h3></article>
            <article className="alert-card danger"><div><strong>HIGH TDS (&gt;950 PPM)</strong><LockKeyhole size={13} /></div><h3>BAHAYA OVERDOSIS: <span>Relai pompa dosing dinonaktifkan permanen. Tambahkan 15-20L air baku jernih ke tandon pengenceran!</span></h3></article>
            <article className="alert-card warning"><div><strong>LOW pH (&lt;5.0)</strong><CircleHelp size={13} /></div><h3>BAHAYA pH ASAM: <span>Segera tambahkan larutan pH Up (KOH) bertahap 10ml ke dalam aliran outlet tandon utama</span></h3></article>
            <article className="alert-card warning"><div><strong>HIGH pH (&gt;7.0)</strong><CircleHelp size={13} /></div><h3>BAHAYA pH BASA: <span>Larutan menghambat serapan Fe &amp; P. Tambahkan larutan pH Down (Asam Fosfat) secara berkala!</span></h3></article>
          </div>
        </section>

        <section className="audit-panel panel" id="audit">
          <div className="panel-heading audit-heading">
            <div><h2>Event Audit Trail Log (Real-Time Records)</h2><p>Riwayat otomatis injeksi mikrokontroler, fluktuasi air, dan status interlock</p></div>
            <div className="audit-tools">
              <label className="search-field"><Search size={14} /><input type="search" placeholder="Cari status, waktu..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
              <label className="select-field"><select value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setPage(1) }}><option>Semua Event</option>{[...new Set(events.map((event) => event.type))].map((type) => <option key={type}>{type}</option>)}</select><ChevronDown size={12} /></label>
              <button className="download-button" type="button" onClick={downloadLog}><ArrowDownToLine size={14} /> Download Log CSV</button>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>TIMESTAMP</th><th>EVENT TYPE</th><th>STATE NAME</th><th>DESCRIPTION / TELEMETRY RECORD</th><th>ACTION</th></tr></thead>
              <tbody>
                {visibleEvents.map((event) => (
                  <tr key={`${event.time}-${event.type}`}>
                    <td className="time-cell">{event.time}</td>
                    <td><span className={`event-tag ${event.tone}`}><i />{event.type}</span></td>
                    <td className="state-cell">{event.name}</td>
                    <td className="description-cell">{event.description}</td>
                    <td><button className="row-action" type="button" aria-label={`Buka detail ${event.name}`} onClick={() => setModal({ type: 'event', event })}><ExternalLink size={13} /></button></td>
                  </tr>
                ))}
                {visibleEvents.length === 0 && <tr><td className="empty-row" colSpan="5">Tidak ada catatan yang cocok dengan pencarian.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>Menampilkan {filteredEvents.length ? (page - 1) * 5 + 1 : 0}–{Math.min(page * 5, filteredEvents.length)} dari {filteredEvents.length} rekaman audit</span>
            <div className="pagination">
              <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Sebelumnya</button>
              <span>{page} / {pageCount}</span>
              <button type="button" disabled={page === pageCount} onClick={() => setPage(page + 1)}>Selanjutnya</button>
            </div>
          </div>
        </section>

        <footer className="footer">
          <div><Leaf size={12} /><span>AUTO-SELADA © 2026</span></div>
          <p>Dikembangkan oleh Tim Selada Happy • FT Universitas Tidar</p>
        </footer>
      </main>
      {apiError && <div className="api-error" role="status">Backend tidak dapat dimuat: {apiError}</div>}
      {modal && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}>
          <section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="modal-heading">
              <div>
                <h2 id="modal-title">
                  {modal.type === 'device' && 'Detail Status Perangkat'}
                  {modal.type === 'calibration' && `Histori Probe ${modal.sensor}`}
                  {modal.type === 'cooldown' && 'Rincian Siklus Pemompaan'}
                  {modal.type === 'event' && 'Detail Data Event'}
                </h2>
                <p>{deviceId}</p>
              </div>
              <button type="button" className="modal-close" aria-label="Tutup" onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            <div className="modal-content">
              {modal.type === 'device' && (
                <dl className="device-detail-list">
                  <div><dt>Status</dt><dd>{online ? 'Online' : 'Offline / belum ada telemetry baru'}</dd></div>
                  <div><dt>IP Address</dt><dd>{deviceInfo.ip_address || deviceInfo.ip || 'Belum dikirim perangkat'}</dd></div>
                  <div><dt>MAC Address</dt><dd>{deviceInfo.mac_address || deviceInfo.mac || 'Belum dikirim perangkat'}</dd></div>
                  <div><dt>Uptime</dt><dd>{deviceInfo.uptime_seconds != null ? `${deviceInfo.uptime_seconds} detik` : 'Belum dikirim perangkat'}</dd></div>
                  <div><dt>Wi-Fi RSSI</dt><dd>{deviceInfo.wifi_rssi_dbm ?? deviceInfo.rssi_dbm ?? 'Belum dikirim perangkat'}</dd></div>
                  <div><dt>Terakhir diterima</dt><dd>{latestSensor?.created_at || 'Belum ada data'}</dd></div>
                </dl>
              )}
              {modal.type === 'calibration' && (
                <>
                  <p className="modal-notice">Backend saat ini belum menyimpan catatan kalibrasi sensor {modal.sensor}. Nilai berikut adalah histori pembacaan sensor, bukan hasil kalibrasi.</p>
                  <ul className="history-list">
                    {sensorHistory.slice(-8).reverse().map((record) => (
                      <li key={record.log_id}>
                        <time>{record.created_at}</time>
                        <strong>{modal.sensor === 'pH' ? `${Number(record.ph_value).toFixed(2)} pH` : `${record.tds_ppm} PPM`}</strong>
                      </li>
                    ))}
                    {sensorHistory.length === 0 && <li>Belum ada histori pembacaan.</li>}
                  </ul>
                </>
              )}
              {modal.type === 'cooldown' && (
                <dl className="device-detail-list">
                  <div><dt>Siklus pemompaan hari ini</dt><dd>{dailyStats?.pump_cycles ?? 'Belum tersedia'} siklus</dd></div>
                  <div><dt>Cooldown aktif</dt><dd>{dailyStats?.cooldown_active ? 'Ya' : 'Tidak'}</dd></div>
                  <div><dt>Sisa cooldown</dt><dd>{dailyStats?.cooldown_remaining_seconds ?? '—'} detik</dd></div>
                  <div><dt>Data dihitung dari</dt><dd>Perintah pompa yang tercatat di audit log hari ini</dd></div>
                </dl>
              )}
              {modal.type === 'event' && (
                <>
                  <p className="modal-notice">{modal.event.time} • {modal.event.type} • {modal.event.name}</p>
                  <pre className="json-view">{JSON.stringify(modal.event.rawPayload, null, 2)}</pre>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
