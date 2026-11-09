import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Config } from '../config.js'
import { matchPointOfSale } from '../core/match.js'
import type { Processor } from '../processor.js'
import { RateLimiter, parseCookies, signToken, verifyPassword, verifyToken } from '../security.js'
import type { Store } from '../store/types.js'

export interface Deps { store: Store; config: Config; processor: Processor; limiter?: RateLimiter }

interface JobState { log: string[]; warnings: string[] }

const PV_COOKIE = 'pv_session'
const ADMIN_COOKIE = 'admin_session'
const PV_TTL = 8 * 3600
const ADMIN_TTL = 12 * 3600
const safe = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')

class HttpError extends Error {
  constructor(public status: number, message: string, public headers: Record<string, string> = {}) { super(message) }
}

export function createApp({ store, config, processor, limiter = new RateLimiter() }: Deps): http.Server {
  const jobs = new Map<number, JobState>()
  let queue: Promise<void> = Promise.resolve() // un archivo a la vez, para cuidar la memoria

  const clientIp = (req: http.IncomingMessage) => {
    if (config.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim()
      if (xff) return xff
    }
    return req.socket.remoteAddress ?? 'desconocida'
  }

  const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
    })
    res.end(JSON.stringify(body))
  }

  const cookie = (name: string, value: string, maxAge: number) =>
    `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? '; Secure' : ''}`

  const readJson = async (req: http.IncomingMessage): Promise<any> => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const c of req) {
      size += (c as Buffer).length
      if (size > 10_000) throw new HttpError(413, 'Solicitud demasiado grande.')
      chunks.push(c as Buffer)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw new HttpError(400, 'JSON inválido.') }
  }

  const tooMany = (secs: number) =>
    new HttpError(429, `Demasiados intentos. Intenta de nuevo en ${Math.max(1, Math.ceil(secs / 60))} minuto(s).`, { 'Retry-After': String(secs) })

  async function receiveUpload(req: http.IncomingMessage): Promise<string> {
    const tmp = join(tmpdir(), `rp-${randomBytes(8).toString('hex')}.xlsx`)
    let bytes = 0
    const limit = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length
        bytes > config.maxUploadBytes ? cb(new HttpError(413, `El archivo supera ${Math.round(config.maxUploadBytes / 1048576)} MB.`)) : cb(null, chunk)
      },
    })
    try {
      await pipeline(req, limit, createWriteStream(tmp))
    } catch (e) {
      await unlink(tmp).catch(() => {})
      throw e
    }
    if (bytes < 100) { await unlink(tmp).catch(() => {}); throw new HttpError(400, 'El archivo está vacío.') }
    return tmp
  }

  function startJob(eventId: number, tmp: string, eventName: string) {
    const state: JobState = { log: [], warnings: [] }
    jobs.set(eventId, state)
    queue = queue.then(async () => {
      try {
        const r = await processor(tmp, eventName, (m) => state.log.push(m))
        state.warnings = r.warnings
        await store.saveResults(eventId, r.items, r.totals)
        state.log.push('Listo.')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        state.log.push(`Error: ${msg}`)
        await store.setEventError(eventId, msg)
      } finally {
        await unlink(tmp).catch(() => {})
      }
    })
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const method = req.method ?? 'GET'
    const ip = clientIp(req)
    const cookies = parseCookies(req.headers.cookie)
    const pvSession = verifyToken<{ role: 'pv'; pv: string }>(cookies[PV_COOKIE], config.secret)
    const pv = pvSession?.role === 'pv' ? pvSession.pv : null
    const adminSession = verifyToken<{ role: 'admin' }>(cookies[ADMIN_COOKIE], config.secret)
    const isAdmin = adminSession?.role === 'admin'
    const eventId = Number(url.searchParams.get('event'))

    // ---------- Puntos de venta ----------
    if (method === 'GET' && path === '/api/pv/list') {
      return send(res, 200, { pointsOfSale: await store.allPvNames() })
    }
    if (method === 'POST' && path === '/api/login') {
      const wait = limiter.blocked(`pv:${ip}`)
      if (wait) throw tooMany(wait)
      const body = await readJson(req)
      const typed = typeof body.pv === 'string' ? body.pv.slice(0, 120) : ''
      const m = matchPointOfSale(typed, await store.allPvNames())
      if (m.status !== 'match') {
        limiter.fail(`pv:${ip}`)
        throw new HttpError(404, 'No encontramos ese punto de venta.') // mismo mensaje siempre: nunca se revelan otros nombres
      }
      return send(res, 200, { ok: true, pv: m.name }, { 'Set-Cookie': cookie(PV_COOKIE, signToken({ role: 'pv', pv: m.name }, config.secret, PV_TTL), PV_TTL) })
    }
    if (method === 'POST' && path === '/api/logout') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': [cookie(PV_COOKIE, '', 0), cookie(ADMIN_COOKIE, '', 0)] })
    }
    if (method === 'GET' && path === '/api/me') {
      return send(res, 200, { pv, admin: isAdmin })
    }
    if (path.startsWith('/api/pv/')) {
      if (!pv) throw new HttpError(401, 'Inicia sesión con tu punto de venta.')
      if (method === 'GET' && path === '/api/pv/events') return send(res, 200, { pv, events: await store.eventsForPv(pv) })
      if (method === 'GET' && path === '/api/pv/report') {
        const r = await store.getReport(eventId, pv)
        if (!r) throw new HttpError(404, 'No hay información de ese evento.')
        return send(res, 200, r)
      }
      if (method === 'GET' && path === '/api/pv/download') {
        const file = await store.getFile(eventId, pv)
        const ev = (await store.eventsForPv(pv)).find((e) => e.id === eventId)
        if (!file || !ev) throw new HttpError(404, 'No hay archivo de ese evento.')
        const name = `${safe(pv)}_${safe(ev.name)}.xlsx`
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          'Content-Length': String(file.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        })
        return void res.end(file)
      }
    }

    // ---------- Administrador ----------
    if (method === 'POST' && path === '/api/admin/login') {
      if (!config.adminPasswordHash) throw new HttpError(503, 'El administrador no está configurado.')
      const wait = limiter.blocked(`admin:${ip}`)
      if (wait) throw tooMany(wait)
      const body = await readJson(req)
      const ok = body.user === config.adminUser && typeof body.password === 'string' && verifyPassword(body.password, config.adminPasswordHash)
      if (!ok) { limiter.fail(`admin:${ip}`); throw new HttpError(401, 'Usuario o contraseña incorrectos.') }
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(ADMIN_COOKIE, signToken({ role: 'admin' }, config.secret, ADMIN_TTL), ADMIN_TTL) })
    }
    if (path.startsWith('/api/admin/')) {
      if (!isAdmin) throw new HttpError(401, 'Acceso solo para el administrador.')
      if (method === 'GET' && path === '/api/admin/events') return send(res, 200, { events: await store.listEvents() })
      if (method === 'PUT' && path === '/api/admin/events') {
        const name = (url.searchParams.get('name') ?? '').trim().slice(0, 120)
        if (!name) throw new HttpError(400, 'Falta el nombre del evento.')
        const tmp = await receiveUpload(req)
        const id = await store.createEvent(name)
        startJob(id, tmp, name)
        return send(res, 202, { id })
      }
      const m = path.match(/^\/api\/admin\/events\/(\d+)(\/status)?$/)
      if (m) {
        const id = Number(m[1])
        if (method === 'GET' && m[2]) {
          const ev = (await store.listEvents()).find((e) => e.id === id)
          if (!ev) throw new HttpError(404, 'Evento no encontrado.')
          return send(res, 200, { event: ev, log: jobs.get(id)?.log ?? [], warnings: jobs.get(id)?.warnings ?? [] })
        }
        if (method === 'DELETE' && !m[2]) {
          if (!(await store.deleteEvent(id))) throw new HttpError(404, 'Evento no encontrado.')
          jobs.delete(id)
          return send(res, 200, { ok: true })
        }
      }
    }
    throw new HttpError(404, 'No encontrado.')
  }

  return http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message }, e.headers)
      console.error(e)
      send(res, 500, { error: 'Error interno del servidor.' })
    })
  })
}