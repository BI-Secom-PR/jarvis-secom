---
title: Setup e Comandos
tags:
  - dev
  - setup
---

# Setup e Comandos

## Desenvolvimento

```bash
npm run dev     # http://localhost:3000
npm run build
npm run start
```

Package manager: **Bun** (`bun.lock`), mas `npm` funciona.

## Variáveis de Ambiente (`.env.local`)

```env
# AI
GOOGLE_GENERATIVE_AI_API_KEY=
GROQ_API_KEY=

# PostgreSQL (auth/sessões)
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=
PG_USER=
PG_PASSWORD=          # caracteres especiais: PG_PASSWORD="p@ss&word"

# MySQL (data warehouse — read-only)
MYSQL_HOST=
MYSQL_USER=
MYSQL_PASSWORD=
# MYSQL_DATABASE hardcoded como airbyte_secom

# Email
RESEND_API_KEY=
RESEND_FROM=

# App
NEXT_PUBLIC_BASE_URL=

# Seed (roda uma vez)
ADMIN_EMAIL=
ADMIN_PASSWORD=
ADMIN_NAME=
```

## Banco de Dados

```bash
npm run db:push      # dev (sem migration)
npm run db:generate  # gera migration versionada
npm run db:migrate   # aplica (produção)
npm run db:seed      # cria admin (uma vez)
```

## SSH Tunnel

```bash
npm run tunnel
npm run tunnel:close
npm run tunnel:status
```

---

Ver também: [[Arquivos Chave]] · [[PostgreSQL Local]]
