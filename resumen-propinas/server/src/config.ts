export interface Config {
  port: number
  secret: string
  adminUser: string
  adminPasswordHash: string
  maxUploadBytes: number
  secureCookies: boolean
  trustProxy: boolean
  dbHost: string
  dbPort: number
  dbUser: string
  dbPassword: string
  dbName: string
}

/** Lee la configuración de variables de entorno. Los secretos nunca se guardan en el repositorio. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const prod = env.NODE_ENV === 'production'
  const secret = env.SESSION_SECRET ?? ''
  if (prod && secret.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.')
  if (prod && !env.ADMIN_PASSWORD_HASH) throw new Error('Falta ADMIN_PASSWORD_HASH.')
  return {
    port: Number(env.PORT ?? 3000),
    secret: secret || 'clave-solo-para-pruebas-locales-0123456789abcdef',
    adminUser: env.ADMIN_USER ?? 'admin',
    adminPasswordHash: env.ADMIN_PASSWORD_HASH ?? '',
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 300) * 1048576,
    secureCookies: prod,
    trustProxy: prod,
    dbHost: env.DB_HOST ?? '',
    dbPort: Number(env.DB_PORT ?? 4000),
    dbUser: env.DB_USER ?? '',
    dbPassword: env.DB_PASSWORD ?? '',
    dbName: env.DB_NAME ?? 'resumen_propinas',
  }
}
