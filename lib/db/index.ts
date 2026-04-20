import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { isNeonHost, pgEnv } from './env'

// Singleton — prevents multiple connections during Next.js hot reload
const globalForPg = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> }
const client = globalForPg.pgClient ?? postgres({
  host:            pgEnv.host,
  port:            pgEnv.port,
  database:        pgEnv.database,
  username:        pgEnv.user,
  password:        pgEnv.password,
  ssl:             isNeonHost ? 'require' : false,
  max:             10,
  connect_timeout: 5,
  idle_timeout:    30,
  max_lifetime:    1800,
})
if (process.env.NODE_ENV !== 'production') globalForPg.pgClient = client

export const db = drizzle(client, { schema })
