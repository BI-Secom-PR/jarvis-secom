import { pgTable, pgEnum, uuid, text, boolean, timestamp, json, integer, customType } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea' },
})

export const roleEnum        = pgEnum('role',         ['ADMIN', 'USER'])
export const messageRoleEnum = pgEnum('message_role', ['USER',  'AI'])

export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  email:        text('email').notNull().unique(),
  name:         text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role:         roleEnum('role').notNull().default('USER'),
  enabled:      boolean('enabled').notNull().default(false),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  // token IS the primary key — lookups are always WHERE token = ?
  token:     text('token').primaryKey(),       // 64-byte random hex, 128 chars
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeen:  timestamp('last_seen',  { withTimezone: true }).notNull().defaultNow(),
})

export const chatSessions = pgTable('chat_sessions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title:     text('title').notNull().default('Nova conversa'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const chatMessages = pgTable('chat_messages', {
  id:            uuid('id').primaryKey().defaultRandom(),
  chatSessionId: uuid('chat_session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role:          messageRoleEnum('role').notNull(),
  content:       text('content').notNull(),
  chartData:     json('chart_data'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const fileExports = pgTable('file_exports', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  chatSessionId:  uuid('chat_session_id').references(() => chatSessions.id, { onDelete: 'set null' }),
  filename:       text('filename').notNull(),
  mimeType:       text('mime_type').notNull(),
  bytes:          bytea('bytes').notNull(),
  sizeBytes:      integer('size_bytes').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt:      timestamp('expires_at', { withTimezone: true }).notNull(),
})

// RAG: (question → SQL) example library, retrieved by embedding similarity
// and injected into the chat system prompt. Embeddings are 768-dim vectors
// (nomic-embed-text via Ollama) stored as JSON — at <5k rows, brute-force
// cosine in TS beats a pgvector dependency.
export const sqlExamples = pgTable('sql_examples', {
  id:        uuid('id').primaryKey().defaultRandom(),
  question:  text('question').notNull().unique(),
  sql:       text('sql').notNull(),
  dims:      json('dims').$type<string[]>(),
  embedding: json('embedding').$type<number[]>(),
  enabled:   boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type User        = typeof users.$inferSelect
export type Session     = typeof sessions.$inferSelect
export type ChatSession = typeof chatSessions.$inferSelect
export type ChatMessage = typeof chatMessages.$inferSelect
export type FileExport  = typeof fileExports.$inferSelect
export type SqlExample  = typeof sqlExamples.$inferSelect
