import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import type http from 'node:http'
import { loadConfig } from '../src/config.js'
import { buildAllReports, joinOrders } from '../src/core/aggregate.js'
import { createApp } from '../src/http/app.js'
import type { Processor } from '../src/processor.js'
import { RateLimiter, hashPassword, signToken, verifyToken } from '../src/security.js'
import { MemoryStore } from '../src/store/memory.js'

// Procesador FALSO: usa los datos de prueba en lugar de leer un Excel (así la prueba no necesita ExcelJS).
const fx = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8'))
const { orders } = joinOrders(fx.data, fx.lines, fx.pays)
const reports = buildAllReports(orders, fx.lines)
const fake: Processor = async (_f, name, log) => {
  log('leyendo...')
  const items = [...reports].map(([pv, report]) => ({ pv, report, xlsx: Buffer.from(`xlsx:${name}:${pv}`) }))
  return { items, totals: { ordenes: orders.length, sinPropina: 1, propina: 2 }, warnings: ['aviso de prueba'] }
}

const config = { ...loadConfig({}), adminPasswordHash: hashPassword('clave-super-segura'), maxUploadBytes: 5000 }
let server: http.Server, base = '', store: MemoryStore

before(async () => {
  store = new MemoryStore()
  server = createApp({ store, config, processor: fake, limiter: new RateLimiter(5, 60_000) })
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

async function api(path: string, opts: { method?: string; body?: unknown; raw?: Buffer; cookie?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  })
  const setCookie = res.headers.getSetCookie().map((c) => c.split(';')[0]!).join('; ')
  const type = res.headers.get('content-type') ?? ''
  return { status: res.status, cookie: setCookie, headers: res.headers, json: type.includes('json') ? await res.json() : null, buf: type.includes('json') ? null : Buffer.from(await res.arrayBuffer()) }
}

let adminCookie = ''
const upload = async (name: string) => {
  const r = await api(`/api/admin/events?name=${encodeURIComponent(name)}`, { method: 'PUT', raw: Buffer.alloc(200, 1), cookie: adminCookie })
  assert.equal(r.status, 202)
  for (let i = 0; i < 100; i++) {
    const s = await api(`/api/admin/events/${r.json.id}/status`, { cookie: adminCookie })
    if (s.json.event.status !== 'processing') return { id: r.json.id as number, status: s.json }
    await new Promise((x) => setTimeout(x, 20))
  }
  throw new Error('el proceso no terminó')
}

test('tokens: firmados, con vencimiento y a prueba de cambios', () => {
  const t = signToken({ role: 'pv', pv: 'X' }, 's'.repeat(40), 60)
  assert.equal(verifyToken<any>(t, 's'.repeat(40))?.pv, 'X')
  assert.equal(verifyToken(t, 'otra-clave'.repeat(5)), null)
  assert.equal(verifyToken(t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), 's'.repeat(40)), null)
  const [body, sig] = t.split('.')
  const forged = Buffer.from(JSON.stringify({ role: 'admin', exp: 9999999999 })).toString('base64url')
  assert.equal(verifyToken(`${forged}.${sig}`, 's'.repeat(40)), null)
  assert.equal(verifyToken(t, 's'.repeat(40), Date.now() + 61_000), null, 'vencido')
  assert.ok(body)
})

test('el administrador: login, y los puntos de venta NO tienen acceso al panel', async () => {
  assert.equal((await api('/api/admin/events')).status, 401)
  assert.equal((await api('/api/admin/login', { method: 'POST', body: { user: 'admin', password: 'mal' } })).status, 401)
  const ok = await api('/api/admin/login', { method: 'POST', body: { user: 'admin', password: 'clave-super-segura' } })
  assert.equal(ok.status, 200)
  adminCookie = ok.cookie
  assert.equal((await api('/api/admin/events', { cookie: adminCookie })).status, 200)
  // una cookie falsificada no sirve
  assert.equal((await api('/api/admin/events', { cookie: 'admin_session=abc.def' })).status, 401)
})

test('subir un evento: se procesa, queda listo y se puede consultar el avance', async () => {
  const noName = await api('/api/admin/events', { method: 'PUT', raw: Buffer.alloc(200), cookie: adminCookie })
  assert.equal(noName.status, 400)
  const big = await api('/api/admin/events?name=x', { method: 'PUT', raw: Buffer.alloc(6000), cookie: adminCookie })
  assert.equal(big.status, 413, 'archivo demasiado grande')
  const { status } = await upload('Festival Ultra Día 1')
  assert.equal(status.event.status, 'ready')
  assert.equal(status.event.pvCount, 57)
  assert.deepEqual(status.warnings, ['aviso de prueba'])
})

test('login de punto de venta: tolerante, y siempre el mismo mensaje cuando falla', async () => {
  for (const typed of ['barra 5 stage 2 alcohol', 'BARRA  5  STAGE 2  ALCOHOL', 'barra 5 stage 2 alcohl', 'vip barra bañós mixtas']) {
    const r = await api('/api/login', { method: 'POST', body: { pv: typed } })
    assert.equal(r.status, 200, typed)
    assert.ok(r.json.pv)
  }
  const a = await api('/api/login', { method: 'POST', body: { pv: 'barra 5 stage 2' } }) // ambiguo
  const b = await api('/api/login', { method: 'POST', body: { pv: 'no existe' } })
  assert.equal(a.status, 404)
  assert.deepEqual(a.json, b.json, 'mismo mensaje: no revela si existe algo parecido')
})

test('cada punto de venta ve SOLO lo suyo y descarga su Excel', async () => {
  const login = await api('/api/login', { method: 'POST', body: { pv: 'barra 5 stage 2 alcohol' } })
  const cookie = login.cookie
  const ev = await api('/api/pv/events', { cookie })
  assert.equal(ev.json.pv, 'BARRA 5 STAGE 2 ALCOHOL')
  assert.equal(ev.json.events.length, 1)
  const id = ev.json.events[0].id
  const rep = await api(`/api/pv/report?event=${id}`, { cookie })
  assert.equal(rep.json.pv, 'BARRA 5 STAGE 2 ALCOHOL')
  assert.equal(rep.json.kpis.sinPropina, 486120)
  const dl = await api(`/api/pv/download?event=${id}`, { cookie })
  assert.equal(dl.buf!.toString(), 'xlsx:Festival Ultra Día 1:BARRA 5 STAGE 2 ALCOHOL')
  assert.match(dl.headers.get('content-disposition')!, /BARRA_5_STAGE_2_ALCOHOL_Festival_Ultra_Dia_1\.xlsx/)
  assert.equal((await api('/api/pv/events')).status, 401, 'sin sesión no hay acceso')
  assert.equal((await api('/api/pv/report?event=9999', { cookie })).status, 404)
  // la cookie de punto de venta no abre el panel de administrador
  assert.equal((await api('/api/admin/events', { cookie })).status, 401)
})

test('historial: varios eventos, el más nuevo primero; borrar uno vacía sus datos', async () => {
  const second = await upload('Festival Ultra Día 2')
  const list = await api('/api/admin/events', { cookie: adminCookie })
  assert.deepEqual(list.json.events.map((e: any) => e.name), ['Festival Ultra Día 2', 'Festival Ultra Día 1'])
  const login = await api('/api/login', { method: 'POST', body: { pv: 'barra 5 stage 2 alcohol' } })
  assert.equal((await api('/api/pv/events', { cookie: login.cookie })).json.events.length, 2)

  assert.equal((await api(`/api/admin/events/${second.id}`, { method: 'DELETE', cookie: adminCookie })).status, 200)
  assert.equal((await api(`/api/admin/events/${second.id}`, { method: 'DELETE', cookie: adminCookie })).status, 404)
  assert.equal((await api(`/api/pv/report?event=${second.id}`, { cookie: login.cookie })).status, 404)
  assert.equal((await api('/api/pv/events', { cookie: login.cookie })).json.events.length, 1)
  assert.equal((await api('/api/admin/events', { method: 'GET', cookie: adminCookie })).json.events.length, 1)
})

test('un error al procesar queda registrado y no tumba el servidor', async () => {
  const bad = createApp({ store: new MemoryStore(), config, processor: async () => { throw new Error('El archivo no trae las hojas esperadas') } })
  await new Promise<void>((r) => bad.listen(0, r))
  const b = `http://127.0.0.1:${(bad.address() as AddressInfo).port}`
  const login = await fetch(`${b}/api/admin/login`, { method: 'POST', body: JSON.stringify({ user: 'admin', password: 'clave-super-segura' }) })
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const up = await fetch(`${b}/api/admin/events?name=Malo`, { method: 'PUT', body: Buffer.alloc(200), headers: { cookie } })
  const { id } = await up.json()
  await new Promise((x) => setTimeout(x, 100))
  const st = await (await fetch(`${b}/api/admin/events/${id}/status`, { headers: { cookie } })).json()
  assert.equal(st.event.status, 'error')
  assert.match(st.event.error, /hojas esperadas/)
  assert.equal((await fetch(`${b}/api/me`)).status, 200, 'sigue vivo')
  bad.close()
})

test('límite de intentos: tras 5 fallos se bloquea, aun con un nombre correcto', async () => {
  const s2 = createApp({ store, config, processor: fake, limiter: new RateLimiter(5, 60_000) })
  await new Promise<void>((r) => s2.listen(0, r))
  const b = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`
  const post = (pv: string) => fetch(`${b}/api/login`, { method: 'POST', body: JSON.stringify({ pv }) })
  for (let i = 0; i < 5; i++) assert.equal((await post(`intento ${i}`)).status, 404)
  const blocked = await post('barra 5 stage 2 alcohol')
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('retry-after')) > 0)
  s2.close()
})