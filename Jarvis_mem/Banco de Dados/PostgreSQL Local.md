---
title: PostgreSQL Local
tags:
  - banco-de-dados
  - postgresql
  - dev
---

# PostgreSQL Local (Desenvolvimento)

## Container Docker

```bash
# Imagem:  postgres:16-alpine
# Nome:    jarvis-pg
# Porta:   5432
# Volume:  jarvis-pg-data
```

`.env.local` → `PG_HOST=localhost`

## Schema (Drizzle ORM)

**Arquivo:** `lib/db/schema.ts`

```
users          → id, email, name, role, enabled, createdAt
sessions       → token (64 hex), userId, expiresAt
chatSessions   → id, userId, title, createdAt
chatMessages   → id, sessionId, role, content, createdAt
```

## Comandos

```bash
npm run db:push      # Push schema (dev — sem migration files)
npm run db:generate  # Gera migration files versionados
npm run db:migrate   # Aplica migrations (usar em produção)
npm run db:seed      # Cria admin inicial (roda uma vez)
```

## SSH Tunnel (se necessário)

```bash
npm run tunnel          # Abre tunnel
npm run tunnel:close    # Fecha tunnel
npm run tunnel:status   # Status
```

---

Ver também: [[Setup e Comandos]]
