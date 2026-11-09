import { useEffect, useState } from 'react'
import { Activity, ArrowDownToLine, BarChart3, CheckCircle2, Clock3, FileSpreadsheet, LockKeyhole, LogOut, RefreshCw, ShieldCheck, Store, Trash2, UploadCloud } from 'lucide-react'

type Session = { pv: string | null; admin: boolean }
type EventItem = { id: number; name: string; createdAt: string; status: 'processing' | 'ready' | 'error'; error?: string; pvCount: number; ordenes: number; sinPropina: number; propina: number }
type PvEvent = { id: number; name: string; createdAt: string }
type Report = { pv: string; kpis: { ordenes: number; unidades: number; terminales: number; sinPropina: number; propina: number; conPropina: number; propinaPct: number }; terminales: { terminal: string; ordenes: number; unidades: number; sinPropina: number; propina: number; conPropina: number }[] }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Ocurrió un error al comunicarse con el servidor.')
  return data as T
}

const money = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value || 0)
const date = (value: string) => new Date(value).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')

  async function refreshSession() {
    try { setSession(await api<Session>('/api/me')) }
    catch (e) { setError((e as Error).message) }
    finally { setChecking(false) }
  }

  useEffect(() => { void refreshSession() }, [])

  async function logout() {
    await api('/api/logout', { method: 'POST' })
    setSession({ pv: null, admin: false })
    setError('')
  }

  if (checking) return <main className="center-screen"><div className="loader" /></main>
  if (!session || (!session.admin && !session.pv)) return <Login onLogin={refreshSession} />
  if (session.admin) return <AdminDashboard onLogout={logout} />
  return <PvDashboard pv={session.pv!} onLogout={logout} />
}

function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [mode, setMode] = useState<'pv' | 'admin'>('pv')
  const [pv, setPv] = useState('')
  const [user, setUser] = useState('admin')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      await api(mode === 'pv' ? '/api/login' : '/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'pv' ? { pv } : { user, password }),
      })
      await onLogin()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  return <main className="login-layout">
    <section className="login-card">
      <div className="brand-mark"><BarChart3 size={22} /></div>
      <div className="eyebrow">CONTROL DE EVENTOS</div>
      <h1>Resumen de <span>Propinas</span></h1>
      <p className="muted intro">Consulta ventas, terminales y propinas desde un solo lugar.</p>
      <div className="tabs">
        <button className={mode === 'pv' ? 'tab active' : 'tab'} onClick={() => { setMode('pv'); setError('') }}><Store size={16} /> Punto de venta</button>
        <button className={mode === 'admin' ? 'tab active' : 'tab'} onClick={() => { setMode('admin'); setError('') }}><ShieldCheck size={16} /> Administrador</button>
      </div>
      <form onSubmit={submit} className="form-stack">
        {mode === 'pv' ? <label>Nombre del punto de venta<input autoFocus value={pv} onChange={e => setPv(e.target.value)} placeholder="Ej. BARRA 5 STAGE 2" required /></label> : <>
          <label>Usuario<input value={user} onChange={e => setUser(e.target.value)} autoComplete="username" required /></label>
          <label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        </>}
        {error && <div className="alert">{error}</div>}
        <button className="button primary full" disabled={busy}>{busy ? 'Validando…' : 'Ingresar'} <span>→</span></button>
      </form>
      <div className="login-foot"><LockKeyhole size={13} /> Acceso protegido mediante sesión segura</div>
    </section>
    <aside className="login-aside"><div className="aside-orb" /><div className="aside-content"><div className="eyebrow">INFORMACIÓN EN UN SOLO PANEL</div><h2>Los números de tu evento, <span>claros y ordenados.</span></h2><p>Reportes por punto de venta, terminal y producto. Datos listos para consultar y descargar.</p><div className="aside-stats"><div><strong>01</strong><small>Ventas</small></div><div><strong>02</strong><small>Propinas</small></div><div><strong>03</strong><small>Terminales</small></div></div></div></aside>
  </main>
}

function Shell({ title, subtitle, children, onLogout }: { title: string; subtitle: string; children: React.ReactNode; onLogout: () => void }) {
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark small"><BarChart3 size={18} /></div><span>Resumen <b>Propinas</b></span></div><div className="top-actions"><span className="secure-label"><span className="live-dot" /> Sistema activo</span><button className="icon-button" onClick={onLogout} title="Cerrar sesión"><LogOut size={17} /></button></div></header>
    <main className="content"><div className="page-heading"><div><div className="eyebrow">PANEL DE CONTROL</div><h1>{title}</h1><p className="muted">{subtitle}</p></div></div>{children}</main>
    <footer className="footer">Resumen de Propinas <span>·</span> Panel de gestión</footer>
  </div>
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [events, setEvents] = useState<EventItem[]>([])
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    try { const r = await api<{ events: EventItem[] }>('/api/admin/events'); setEvents(r.events) }
    catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!events.some(event => event.status === 'processing')) return
    const timer = window.setInterval(() => { void load() }, 2000)
    return () => window.clearInterval(timer)
  }, [events])

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !name.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api<{ id: number }>(`/api/admin/events?name=${encodeURIComponent(name.trim())}`, { method: 'PUT', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: file })
      setName(''); setFile(null); setNotice('Archivo recibido. El procesamiento comenzó.')
      const input = document.getElementById('excel-file') as HTMLInputElement | null
      if (input) input.value = ''
      await load()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  async function remove(id: number) {
    if (!window.confirm('¿Seguro que deseas eliminar este evento y todos sus reportes?')) return
    try { await api(`/api/admin/events/${id}`, { method: 'DELETE' }); await load() }
    catch (e) { setError((e as Error).message) }
  }

  return <Shell title="Administrador" subtitle="Gestiona archivos, procesa eventos y consulta el historial." onLogout={onLogout}>
    <section className="stats-grid">
      <Stat icon={<FileSpreadsheet />} label="Eventos registrados" value={String(events.length)} />
      <Stat icon={<Store />} label="Puntos de venta" value={String(events.filter(e => e.status === 'ready').reduce((n, e) => Math.max(n, e.pvCount), 0))} />
      <Stat icon={<Activity />} label="Eventos procesados" value={String(events.filter(e => e.status === 'ready').length)} />
    </section>
    <section className="panel upload-panel"><div className="section-title"><div><h2>Nuevo evento</h2><p className="muted">Carga el Excel de registros para generar los reportes.</p></div><div className="section-icon"><UploadCloud size={19} /></div></div>
      <form className="upload-form" onSubmit={upload}><label>Nombre del evento<input value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Festival Ultra Día 2" required /></label><label className="file-picker"><span>Archivo Excel</span><input id="excel-file" type="file" accept=".xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} required /><span className="file-name">{file ? file.name : 'Selecciona un archivo .xlsx'}</span></label><button className="button primary" disabled={busy || !file}>{busy ? 'Subiendo…' : 'Procesar archivo'} <UploadCloud size={16} /></button></form>
      {notice && <div className="success-msg"><CheckCircle2 size={15} />{notice}</div>}{error && <div className="alert">{error}</div>}
    </section>
    <section className="panel"><div className="section-title"><div><h2>Historial de eventos</h2><p className="muted">Archivos procesados y su estado actual.</p></div><button className="button subtle" onClick={() => void load()}><RefreshCw size={15} /> Actualizar</button></div>
      <div className="table-wrap"><table><thead><tr><th>Evento</th><th>Fecha</th><th>Puntos de venta</th><th>Órdenes</th><th>Propinas</th><th>Estado</th><th /></tr></thead><tbody>{events.map(ev => <tr key={ev.id}><td className="strong-cell">{ev.name}</td><td>{date(ev.createdAt)}</td><td>{ev.pvCount || '—'}</td><td>{ev.ordenes ? ev.ordenes.toLocaleString('es-MX') : '—'}</td><td>{ev.status === 'ready' ? money(ev.propina) : '—'}</td><td><Status status={ev.status} /></td><td><button className="icon-button danger" onClick={() => void remove(ev.id)} title="Eliminar evento"><Trash2 size={15} /></button></td></tr>)}{!events.length && <tr><td colSpan={7} className="empty">Todavía no hay eventos registrados.</td></tr>}</tbody></table></div>
    </section>
  </Shell>
}

function PvDashboard({ pv, onLogout }: { pv: string; onLogout: () => void }) {
  const [events, setEvents] = useState<PvEvent[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<{ events: PvEvent[] }>('/api/pv/events').then(r => { setEvents(r.events); if (r.events[0]) setSelected(r.events[0].id) }).catch(e => setError((e as Error).message)) }, [])
  useEffect(() => { if (selected === null) return; api<Report>(`/api/pv/report?event=${selected}`).then(setReport).catch(e => setError((e as Error).message)) }, [selected])
  async function download() {
    try {
      const response = await fetch(`/api/pv/download?event=${selected}`, { credentials: 'include' })
      if (!response.ok) throw new Error('No se pudo descargar el reporte.')
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `reporte-${selected}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setError((e as Error).message) }
  }
  return <Shell title="Punto de venta" subtitle={pv} onLogout={onLogout}>
    <section className="panel event-select"><div><span className="eyebrow">EVENTO</span><h2>Mis reportes</h2></div><select value={selected ?? ''} onChange={e => setSelected(Number(e.target.value))}><option value="" disabled>Selecciona un evento</option>{events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}</select></section>
    {error && <div className="alert">{error}</div>}
    {report ? <><section className="stats-grid four"><Stat icon={<BarChart3 />} label="Órdenes" value={report.kpis.ordenes.toLocaleString('es-MX')} /><Stat icon={<Activity />} label="Unidades vendidas" value={report.kpis.unidades.toLocaleString('es-MX')} /><Stat icon={<Store />} label="Terminales" value={String(report.kpis.terminales)} /><Stat icon={<FileSpreadsheet />} label="Propina" value={money(report.kpis.propina)} /></section>
      <section className="panel"><div className="section-title"><div><h2>Resumen de ventas</h2><p className="muted">Totales del punto de venta seleccionado.</p></div><button className="button primary" onClick={() => void download()}><ArrowDownToLine size={16} /> Descargar Excel</button></div><div className="money-grid"><Money label="Total sin propina" value={money(report.kpis.sinPropina)} /><Money label="Propina" value={money(report.kpis.propina)} /><Money label="Total con propina" value={money(report.kpis.conPropina)} /></div></section>
      <section className="panel"><div className="section-title"><div><h2>Detalle por terminal</h2><p className="muted">Ventas y propinas registradas en cada terminal.</p></div></div><div className="table-wrap"><table><thead><tr><th>Terminal</th><th>Órdenes</th><th>Unidades</th><th>Sin propina</th><th>Propina</th><th>Total con propina</th></tr></thead><tbody>{report.terminales.map(t => <tr key={t.terminal}><td className="strong-cell">{t.terminal}</td><td>{t.ordenes.toLocaleString('es-MX')}</td><td>{t.unidades.toLocaleString('es-MX')}</td><td>{money(t.sinPropina)}</td><td>{money(t.propina)}</td><td>{money(t.conPropina)}</td></tr>)}</tbody></table></div></section>
    </> : <section className="panel empty-state"><FileSpreadsheet size={28} /><h2>Sin reportes disponibles</h2><p className="muted">Cuando el administrador procese un evento que incluya tu punto de venta, aparecerá aquí.</p></section>}
  </Shell>
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="stat-card"><div className="stat-icon">{icon}</div><div><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div></div>
}
function Money({ label, value }: { label: string; value: string }) { return <div className="money-item"><span>{label}</span><strong>{value}</strong></div> }
function Status({ status }: { status: EventItem['status'] }) {
  const labels = { ready: 'Completado', processing: 'Procesando', error: 'Error' }
  const icons = { ready: <CheckCircle2 size={13} />, processing: <Clock3 size={13} />, error: <Activity size={13} /> }
  return <span className={`status ${status}`}>{icons[status]}{labels[status]}</span>
}