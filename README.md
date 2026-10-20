# Jarvis SECOM

AI chat assistant for SECOM marketing analytics. Query ad platform data across Meta, Google, TikTok, Amazon DSP, Kwai, LinkedIn and Pinterest using natural language. Also hosts a media dashboard (`/dashboard`), a comment-sentiment explorer (`/sentimentos`) and the ad verification workflow (comprovante + URL audit parsers).

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| Package manager | Bun (`bun.lock`; npm scripts also work) |
| AI (text) | Ollama (Gemma 4 · 31B), Google Gemini as alternate provider |
| AI (voice) | Browser pt-BR voices by default; Google Gemini 2.5 Flash TTS optional |
| RAG | Google `gemini-embedding-001` over PG `sql_examples` (few-shot SQL retrieval) |
| Auth DB | PostgreSQL 18 + Drizzle ORM |
| Data warehouse | MySQL (`airbyte_secom`, read-only; optional RW user scoped to sentiment corrections) |
| Verification engine | Python (`app/verification/engine.py` + per-adserver parsers) |
| Verification uploads | Supabase Storage (bypasses Vercel's 4.5MB body limit) |
| Email | Resend |
| Deployment | Vercel |

---

## Getting Started

### 1. Prerequisites

- Node.js 22+
- PostgreSQL 18 running (see below)
- API keys for Google Generative AI

### 2. Environment variables

Copy and fill in `.env.local`:

```bash
# AI providers
GOOGLE_GENERATIVE_AI_API_KEY=
OLLAMA_BASE_URL=            # default http://localhost:11434; hosted: https://ollama.com
OLLAMA_API_KEY=             # bearer token, required for hosted Ollama

# Data warehouse (MySQL — read-only)
MYSQL_HOST=
MYSQL_DATABASE=airbyte_secom
MYSQL_USER=
MYSQL_PASSWORD=
# Optional write path (sentiment corrections only — grant UPDATE solely on silver_social_comments)
MYSQL_RW_USER=
MYSQL_RW_PASSWORD=

# PostgreSQL — auth & chat sessions
PG_HOST=
PG_PORT=5432
PG_DATABASE=jarvis_db
PG_USER=
PG_PASSWORD=    # quote the value if it contains special chars: PG_PASSWORD="p@ss&word"

# First admin (used once by db:seed)
ADMIN_EMAIL=admin@secom.gov.br
ADMIN_PASSWORD=
ADMIN_NAME=Administrador

# Email notifications (https://resend.com)
RESEND_API_KEY=
RESEND_FROM=noreply@yourdomain.com
NEXT_PUBLIC_BASE_URL=https://yourdomain.com

# Passkeys (WebAuthn)
WEBAUTHN_SECRET=

# Verification uploads (Supabase Storage)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=      # server-side only
NEXT_PUBLIC_USE_DIRECT_UPLOAD=  # enables direct upload (prod); unset = on-prem FormData

# Voice: 'true' routes TTS through Gemini (free tier: 10 req/day); default uses browser voices
NEXT_PUBLIC_USE_GEMINI_TTS=

# Optional: pin the OCI MySQL CA (PEM) after a rotation; lib/mysql.ts also self-heals on HANDSHAKE_SSL_ERROR
MYSQL_CA=
```

### 3. Database setup

```bash
# Push schema to Postgres (dev)
npm run db:push

# Create first admin user
npm run db:seed
```

### 4. Run

```bash
npm run dev   # http://localhost:3000
```

---

## PostgreSQL via Docker

Run PostgreSQL in a Docker container on any server:

```bash
docker run -d \
  --name jarvis_db \
  --restart unless-stopped \
  -e POSTGRES_DB=jarvis_db \
  -e POSTGRES_USER=<user> \
  -e POSTGRES_PASSWORD=<password> \
  -p 5432:5432 \
  -v postgres_data:/var/lib/postgresql/data \
  postgres:16-alpine
```

Then create the schema and seed the admin:

```bash
npm run db:push
npm run db:seed
```

> **Note:** If the password contains special characters (`&`, `(`, `*`, etc.), quote it in `.env.local`:
> ```
> PG_PASSWORD="your&special*password"
> ```

---

## Authentication

| Route | Description |
|---|---|
| `/login` | Email + password login, or "Entrar com chave de acesso" (passkey) |
| `/register` | Request access (requires admin approval) |
| `/waiting` | Shown after registration or when account is pending |
| `/` | Home menu — links to available tools |
| `/perfil` | Profile: change password, manage passkeys, active sessions |
| `/chat` | AI chat assistant |
| `/dashboard` | Media dashboard over the gold layer (3 tabs: campanhas / demografia / região) |
| `/sentimentos` | Comment sentiment explorer (by campaign/ad, with corrections) |
| `/verification` | Ad verification dashboard (comprovante + URL/category audit) |
| `/admin` | User management (admin only) |

### Roles

| Role | Can access |
|---|---|
| `USER` | Home, Chat, Dashboard, Sentimentos, Verification, Profile |
| `ADMIN` | Everything above + Admin panel (`/admin`), campaign-group rules editor, passkey enrollment |

### Session behaviour

- Sessions are stored in `sessions` table (PostgreSQL)
- Cookie: `jarvis_session_token` — HttpOnly, SameSite=Lax, Secure in production
- 30-day absolute expiry + 3-day idle timeout; each session stores IP and user agent
- Token rotates every 6h (proxy); the previous token is valid for 60s, and reusing it after that revokes the session
- `/perfil` lists active sessions and ends one or all others; changing the password ends the others
- E-mail alert when a never-seen browser + OS signs in (`known_devices`)
- Passkeys: enrollment is admin-gated and one-shot; managed in `/perfil`
- Disabling a user deletes all their active sessions immediately — next request is rejected

### Admin panel features

- View all users with name, email, role and access status
- **Toggle switch** to approve or revoke access instantly
- **Edit** button to update name, email and role inline
- Admins cannot modify their own account

---

## Chat Features

| Feature | Description |
|---|---|
| Model | Gemma 4 · 31B (Ollama, default), Gemini as alternate provider |
| SQL queries | AI generates and executes read-only `SELECT`/`WITH` queries against `airbyte_secom`, guarded by an allowlist + blocklist |
| RAG | Top-3 similar Q→SQL examples retrieved from `sql_examples` and injected into the prompt |
| Charts | AI embeds a `CHART_REQUEST:{...}` sentinel in its reply; the client parses it into bar/line/scatter/geo charts |
| Voice mode | Speech recognition + streaming (SSE) replies, conversation memory, barge-in (interrupt mid-speech); browser pt-BR voices by default |
| Session persistence | Chat messages saved to Postgres per session |
| `⌘N` / `Ctrl+N` | Start a new chat session ("Nova conversa" button on mobile) |

---

## Dashboard

`/dashboard` — media performance over the gold layer, three tabs (`campanhas` / `demografia` / `região`):

- Multi-select faceted filters (OR within a filter, AND across): platform, network, campaign group, theme (eixo), buying type (CPM/CPC/CPV/CPE) and more
- Campaign groups: editable text rules (`TERMO [+ TERMO] => Rótulo`) via an admin-only modal, stored in `app_settings`
- Derived metrics in the selector (CPC, CPV, CPE, VTR, engagement rate); engagement broken down by interaction type (likes + comments + shares + reactions + saves — never the raw `engagements` column)
- Period shortcuts (7/14/30/90 days), choropleth map with zoom/pan, impressions scatter, video block in the table
- AI reading of the filtered slice (`/api/dashboard/insights`), with mix-vs-rate analysis
- Excel export of the filtered slice
- Filters, period, tab and modes persist across refreshes and sessions

---

## Verification

Ad-delivery verification workflow at `/verification`, backed by a Python engine spawned from the API route:

| Piece | Description |
|---|---|
| `app/verification/engine.py` | Reconciles the adserver comprovante (delivery receipt) against the URL/category audit sheet; produces a 29-column "Verificado" workbook |
| `app/verification/parsers/` | One parser per adserver (`adforce`, `metrike`, `00px`, `00px25`, `ahead`, `admotion`, `sense`, `dgbrasil`, `teratech`) — each exposes `parse_comprovante()` and `parse_verif()` |
| `app/api/verification/run/route.ts` | Spawns the engine (or forwards to a Python API route on Vercel), streams progress via SSE, runs an AI brand-safety check on flagged URLs |
| `components/VerificationContainer.tsx` | Upload UI (direct to Supabase Storage in prod, split into 40MB parts), live progress, results table |

Supported adservers, date range, and vehicle-name fuzzy matching (≥85% similarity) are validated before the engine runs.

---

## Database Scripts

```bash
npm run db:push       # Push schema directly (dev — no migration files)
npm run db:generate   # Generate versioned SQL migration files
npm run db:migrate    # Apply pending migration files (production)
npm run db:seed       # Create first admin user from ADMIN_* env vars
```

---

## Production Deployment (Vercel)

1. Connect the GitHub repo to Vercel
2. Add all env vars in the Vercel dashboard
3. Provision a Vercel Postgres database and set `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD` from the connection details
4. Run migrations on first deploy:
   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```
5. Set `NEXT_PUBLIC_BASE_URL` to your production domain

---

## Security

- Rate limiting (in-memory, per-process): login 20/15min per IP + 5/15min per IP+email, register 5/h per IP, external query 30/min per IP
- Register is enumeration-safe (identical response/timing whether the e-mail exists or not)
- Nonce-based CSP generated per-request (`proxy.ts`); pages render dynamically (`force-dynamic`)
- Static security headers (nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS in prod)
- Sessions: 30-day absolute expiry + 3-day idle timeout, 6h token rotation with replay detection, new-device e-mail alert
- MySQL OCI CA: pinned in `lib/mysql.ts`, self-heals on rotation (override with `MYSQL_CA`)
- SQL guard on the MySQL path: allowlist (`SELECT`/`WITH` + `FROM`) and blocklist (`UNION SELECT`, `SLEEP()`, `BENCHMARK()`, `INFORMATION_SCHEMA`, `mysql.*`, `sys.*`, `performance_schema`), plus a read-only DB user
- `EXTERNAL_API_KEY` compared in constant time
- Admin password reset revokes all of the target user's sessions

---

## Project Structure

```
app/
  (auth)/           # Login, register, waiting pages (no URL prefix)
  admin/            # Admin user management panel
  perfil/           # Profile: password, passkeys, active sessions
  dashboard/        # Media dashboard (/dashboard)
  sentimentos/      # Sentiment explorer (/sentimentos)
  chat/             # AI chat page (/chat)
  verification/     # Verification dashboard (/verification)
    engine.py       # Python reconciliation engine (comprovante vs URL/category audit)
    parsers/        # One parser per adserver + category_map.py
  api/
    auth/           # register, login, logout, me, change-password, passkey, sessions
    dashboard/      # filters, data, insights, export, campaign-rules
    sentimentos/    # filters, data, ai-filter, correct, thumb
    exports/        # chart/image exports
    admin/users/    # User list + enable/disable/edit
    chat/           # Main AI chat endpoint (SQL guard, tool-calling, RAG)
    chat-sessions/  # Chat session CRUD + message persistence
    verification/run/ # Spawns engine.py, streams SSE progress, AI URL check
    tts/            # Text-to-speech (Google Gemini)
  page.tsx          # Home menu — cards linking to available tools
components/
  ChatContainer     # Main chat UI + session management
  MessageBubble     # Renders markdown + strips CHART_REQUEST sentinel
  ChartWidget       # Recharts rendering (bar/line/scatter/geo)
  DashboardContainer # /dashboard client (tabs, filters, charts, tables)
  SentimentosContainer # Sentiment explorer UI
  VerificationContainer # Upload UI, SSE progress, results table
  UserMenu          # Name display + logout button
  VoiceMode         # Speech recognition + TTS playback
lib/
  auth.ts           # getSession(), requireAuth(), requireAdmin()
  agent.ts          # System prompt, model selection, chart-sentinel parsing
  mysql.ts          # MySQL pool + SQL guard for the data warehouse
  dashboard.ts      # Dashboard WHERE builder, metric whitelist, buying-type/age maps
  campaignGroups.ts # Campaign group rules → campaign_name[]
  sessions.ts       # Session rotation, listing, revocation
  webauthn.ts       # Passkey helpers
  storage.ts        # Supabase Storage signed URLs
  rag.ts            # Top-k SQL example retrieval over PG sql_examples
  email.ts          # sendApprovalEmail() via Resend
  db/
    schema.ts       # Drizzle schema (users, sessions, chat_sessions, chat_messages)
    index.ts        # DB client singleton
    seed.ts         # Admin user seed script
verification/       # Fixture spreadsheets + regression test data
proxy.ts            # Request guard — redirects unauthenticated requests to /login
```
