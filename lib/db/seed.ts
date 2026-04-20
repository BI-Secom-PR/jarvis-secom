import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { users } from './schema'
import bcrypt from 'bcryptjs'
import { isNeonHost, pgEnv } from './env'

async function main() {
  const email    = process.env.ADMIN_EMAIL!
  const name     = process.env.ADMIN_NAME!
  const password = process.env.ADMIN_PASSWORD!

  if (!email || !name || !password) {
    console.error('Missing ADMIN_EMAIL, ADMIN_NAME or ADMIN_PASSWORD env vars.')
    process.exit(1)
  }

  const client = postgres({
    host:     pgEnv.host,
    port:     pgEnv.port,
    database: pgEnv.database,
    username: pgEnv.user,
    password: pgEnv.password,
    ssl:      isNeonHost ? 'require' : false,
  })
  const db = drizzle(client)

  const passwordHash = await bcrypt.hash(password, 12)

  await db
    .insert(users)
    .values({ email: email.toLowerCase(), name, passwordHash, role: 'ADMIN', enabled: true })
    .onConflictDoNothing()

  console.log(`✓ Admin seeded: ${email}`)
  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
