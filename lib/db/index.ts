import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Singleton — prevents multiple connections during Next.js hot reload
const globalForPg = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> }
const client = globalForPg.pgClient ?? postgres(process.env.DATABASE_URL!, { max: 10 })
if (process.env.NODE_ENV !== 'production') globalForPg.pgClient = client

export const db = drizzle(client, { schema })
