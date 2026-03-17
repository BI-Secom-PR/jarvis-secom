import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db } from './index'

await migrate(db, { migrationsFolder: './lib/db/migrations' })
console.log('Migrations applied.')
process.exit(0)
