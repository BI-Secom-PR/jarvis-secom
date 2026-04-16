import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host:     process.env.PG_HOST!,
    port:     parseInt(process.env.PG_PORT ?? '5432'),
    database: process.env.PG_DATABASE!,
    user:     process.env.PG_USER!,
    password: process.env.PG_PASSWORD!,
    ssl:      process.env.PG_HOST?.includes('neon.tech') ? true : false,
  },
})
