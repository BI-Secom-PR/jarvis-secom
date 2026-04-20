import { defineConfig } from 'drizzle-kit'
import { isNeonHost, pgEnv } from './lib/db/env'

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host:     pgEnv.host,
    port:     pgEnv.port,
    database: pgEnv.database,
    user:     pgEnv.user,
    password: pgEnv.password,
    ssl:      isNeonHost ? true : false,
  },
})
