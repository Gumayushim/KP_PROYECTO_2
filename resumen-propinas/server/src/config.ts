export interface Config {
  port: number
  secret: string
  adminUser: string
  adminPasswordHash: string
  maxUploadBytes: number
  secureCookies: boolean
  trustProxy: boolean
}

/** Lee la configuración de variables de entorno (en Hostinger se definen en el panel de la app). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const prod = env.NODE_ENV === 'production'
  const secret = env.SESSION_SECRET ?? ''
  if (prod && secret.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.')
  if (prod && !env.ADMIN_PASSWORD_HASH) throw new Error('Falta ADMIN_PASSWORD_HASH (se genera con: npm run hash-password -- "tu clave").')
  return {
    port: Number(env.PORT ?? 3000),
    secret: secret || 'clave-solo-para-pruebas-locales-0123456789abcdef',
    adminUser: env.ADMIN_USER ?? 'admin',
    adminPasswordHash: env.ADMIN_PASSWORD_HASH ?? '',
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 300) * 1048576,
    secureCookies: prod,
    trustProxy: prod, // detrás del proxy de Hostinger la IP real viene en X-Forwarded-For
  }
}