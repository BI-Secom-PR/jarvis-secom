# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

**Jarvis SECOM** — a Next.js 16 AI chat app for querying marketing analytics across 7 ad platforms (Meta, Google, TikTok, Kwai, LinkedIn, Pinterest, Amazon DSP) using natural language. The AI generates and executes SQL against a read-only MySQL data warehouse and can produce charts inline.

## Commands

```bash
# Development
npm run dev          # Start dev server at http://localhost:3000

# Database (PostgreSQL)
npm run db:push      # Push schema changes (dev only, no migration files)
npm run db:generate  # Generate versioned migration files
npm run db:migrate   # Apply migrations (use in production)
npm run db:seed      # Create initial admin user (requires ADMIN_* env vars, run once)

# Production
npm run build
npm run start
```

Package manager is **Bun** (`bun.lock` present), but npm scripts work fine.
No test suite exists currently.

## Architecture

### Dual-Database Pattern
- **PostgreSQL** (Drizzle ORM): auth, sessions, chat history — see `lib/db/schema.ts`
- **MySQL** (mysql2 pool): read-only analytics warehouse `airbyte_secom` — see `lib/mysql.ts`

The two databases are accessed through completely separate clients. Never confuse their connection helpers.

### Authentication Flow
Session tokens are 64-byte random hex strings stored in the `sessions` table. The middleware (`proxy.ts`) checks `jarvis_session_token` cookie before all protected routes. Session validation happens in `lib/auth.ts` via `getSession()`, which also enforces 30-day expiry and checks `users.enabled`. Disabling a user immediately invalidates all their sessions.

Use `requireAuth()` for protected route handlers and `requireAdmin()` for admin-only endpoints — both throw redirects on failure.

### AI Chat Pipeline
1. `app/api/chat/route.ts` receives message + conversation history
2. Builds context with system prompt (includes full SQL schema + KPI rules) from `lib/agent.ts`
3. Routes by provider:
   - **Google**: Vercel AI SDK `generateText()` with `execute_sql_query` tool
   - **Ollama**: native `ollama` npm client with manual tool-calling loop (max 6 steps)
4. Two-layer SQL guard: `SAFE_QUERY` requires `SELECT … FROM`; `BLOCKED_PATTERNS` rejects `UNION SELECT`, `SLEEP()`, `BENCHMARK()`, `INFORMATION_SCHEMA`, `mysql.`, `sys.`, `performance_schema`
5. Pipe characters in results are replaced with `∣` to prevent markdown table breakage
6. Client parses `CHART_REQUEST:{...}` sentinel strings from AI response to render Recharts charts

### System Prompt / Skills (`lib/agent.ts`)
The system prompt contains two behavioral skills and several supporting sections:
- **TRATAMENTO DE DATAS** — maps natural language time expressions ("este mês", "semana passada", "Q1") to SQL date ranges
- **EXEMPLOS SQL** — 7 canonical few-shot queries covering the most common patterns (performance by platform, daily evolution, top creatives, geo/demographic breakdown, Kwai/LinkedIn completions, campaign discovery)
- **SKILL DE PERFORMANCE** — auto-activates for performance/KPI questions; detects platform+objective, calculates KPIs, compares to SECOM benchmarks; triggers on broad PT/EN natural language
- **SKILL DE RELATÓRIO** — activates only on explicit keywords ("relatório", "paper", "report"); runs 5-step SQL pipeline and generates a structured markdown report
- **Zero-results recovery** (rule 6): on empty results, retries with broader LIKE, then lists available campaign names
- Default model: **Gemma 4 · 31B** (Ollama cloud)

### Chart Generation
Charts are not returned as structured API data — the AI embeds a JSON sentinel `CHART_REQUEST:{type,data,config}` in its text response. `components/MessageBubble.tsx` detects and strips these, passing the parsed data to `components/ChartWidget.tsx` (Recharts).

### Routing
- `(auth)/` group: `/login`, `/register`, `/waiting` — no auth required
- `/` home menu, `/chat`, `/verification` — require auth (USER role)
- `/admin` — requires ADMIN role
- `app/api/` routes handle all data operations server-side

### Voice Mode
`components/VoiceMode.tsx` is dynamically imported with `ssr: false` to prevent hydration errors with browser-only Web Speech API. TTS uses Google Gemini 2.5 Flash via `/api/tts`.

## Environment Variables

```
# AI
GOOGLE_GENERATIVE_AI_API_KEY
GROQ_API_KEY
OLLAMA_BASE_URL    # Ollama server host (default: http://localhost:11434; cloud: https://ollama.com)
OLLAMA_API_KEY     # Bearer token for hosted Ollama instances

# PostgreSQL (auth/sessions)
PG_HOST / PG_PORT / PG_DATABASE / PG_USER / PG_PASSWORD

# MySQL (data warehouse, read-only)
MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD
# MYSQL_DATABASE is hardcoded as airbyte_secom

# Email (Resend)
RESEND_API_KEY / RESEND_FROM

# App
NEXT_PUBLIC_BASE_URL

# One-time seed only
ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME
```

Special characters in `PG_PASSWORD` must be quoted: `PG_PASSWORD="p@ss&word"`

## Key Files

| File | Purpose |
|------|---------|
| `lib/db/schema.ts` | Drizzle schema: users, sessions, chatSessions, chatMessages |
| `lib/auth.ts` | `getSession()`, `requireAuth()`, `requireAdmin()` |
| `lib/agent.ts` | AI model selection, system prompt with SQL schema |
| `lib/mysql.ts` | MySQL pool + SQL guard for data warehouse queries |
| `proxy.ts` | Next.js middleware — session check, route protection |
| `app/api/chat/route.ts` | Core AI endpoint with tool-use |
| `components/ChatContainer.tsx` | Main chat state management |
| `verification/` | Excel spreadsheets (data, not code) |
| `app/verification/engine.py` | Python verification engine (29-col template) |
| `app/verification/parsers/` | Format-specific parsers + category_map.py |
| `app/api/verification/run/route.ts` | Verification API — spawns engine.py, runs AI URL check |
| `components/VerificationContainer.tsx` | Verification UI |

## Data Warehouse Schema

See `GOLD_LAYER_DATA_DICTIONARY.md` for full column definitions. Key tables:
- `gold_platforms_campaigns` — main fact table (platform + campaign + ad + date grain)
- `gold_platforms_regions` — adds geographic dimension
- `gold_platforms_age` / `gold_platforms_gender` — demographic dimensions

All tables are prefixed `gold_` and the SQL guard enforces this.

## Security Notes

### SQL Guard (MySQL)
Two constants in `app/api/chat/route.ts` and `app/api/external/query/route.ts` protect the MySQL query path:
- `SAFE_QUERY` — allowlist: query must start with `SELECT … FROM`
- `BLOCKED_PATTERNS` — blocklist: rejects `UNION SELECT`, `SLEEP()`, `BENCHMARK()`, `INFORMATION_SCHEMA`, `mysql.*`, `sys.*`, `performance_schema`

Both checks must pass. If either fails the query is rejected with HTTP 400 before touching the database. The MySQL user is also read-only on `airbyte_secom` as a second layer.

### Verification Subprocess Inputs
`app/api/verification/run/route.ts` validates inputs before spawning `engine.py`:
- `adserver` must be one of: `00px`, `adforce`, `admotion`, `ahead`, `metrike`, `brz` (lowercase — matches `engine.py` argparse choices)
- `ini` / `fim` (date range) must match `DD/MM/YYYY` (the format `engine.py` expects)

Validation runs in both the JSON Blob branch and the FormData on-prem branch.

### Known Gaps (not yet fixed)
- No rate limiting on `/api/auth/login`, `/api/auth/register`, `/api/external/query`
- Account enumeration possible via `/waiting` redirect for pending users
- CSP uses `'unsafe-inline'` for scripts — nonce-based CSP not yet implemented
- Sessions have no idle timeout (only 30-day absolute expiry)