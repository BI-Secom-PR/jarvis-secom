const cleanEnv = (value: string | undefined): string | undefined => value?.trim()

const requiredEnv = (name: string): string => {
  const value = cleanEnv(process.env[name])
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

const parsePort = (name: string, fallback: number): number => {
  const value = cleanEnv(process.env[name])
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

export const pgEnv = {
  host: requiredEnv('PG_HOST'),
  port: parsePort('PG_PORT', 5432),
  database: requiredEnv('PG_DATABASE'),
  user: requiredEnv('PG_USER'),
  password: requiredEnv('PG_PASSWORD'),
}

export const isNeonHost = pgEnv.host.includes('neon.tech')
