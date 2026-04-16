import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Singleton — prevents multiple connections during Next.js hot reload
const globalForPg = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> }
const isNeon = process.env.PG_HOST?.includes('neon.tech')
const client = globalForPg.pgClient ?? postgres({
  host:            process.env.PG_HOST!,
  port:            parseInt(process.env.PG_PORT ?? '5432'),
  database:        process.env.PG_DATABASE!,
  username:        process.env.PG_USER!,
  password:        process.env.PG_PASSWORD!,
  ssl:             isNeon ? 'require' : false,
  max:             10,
  connect_timeout: 5,
  idle_timeout:    30,
  max_lifetime:    1800,
})
if (process.env.NODE_ENV !== 'production') globalForPg.pgClient = client

export const db = drizzle(client, { schema })
