import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** Token firmado (como un JWT simple): datos + vencimiento + firma HMAC. Si alguien lo modifica, deja de valer. */
export function signToken(payload: Record<string, unknown>, secret: string, ttlSec: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSec })).toString('base64url')
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}

export function verifyToken<T>(token: string | undefined, secret: string, now = Date.now()): (T & { exp: number }) | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const good = createHmac('sha256', secret).update(body).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== good.length || !timingSafeEqual(given, good)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof p.exp !== 'number' || p.exp * 1000 < now) return null
    return p
  } catch {
    return null
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('base64url')}$${scryptSync(password, salt, 32).toString('base64url')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/** Limita los intentos fallidos por clave (IP) en una ventana de tiempo. */
export class RateLimiter {
  private hits = new Map<string, number[]>()
  constructor(private max = 8, private windowMs = 15 * 60 * 1000) {}

  private recent(key: string, now: number): number[] {
    const a = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    if (a.length) this.hits.set(key, a)
    else this.hits.delete(key)
    return a
  }

  /** Segundos que faltan para poder intentar de nuevo; 0 si no está bloqueado. */
  blocked(key: string, now = Date.now()): number {
    const a = this.recent(key, now)
    return a.length >= this.max ? Math.ceil((a[0]! + this.windowMs - now) / 1000) : 0
  }

  fail(key: string, now = Date.now()): void {
    const a = this.recent(key, now)
    a.push(now)
    this.hits.set(key, a)
  }
}