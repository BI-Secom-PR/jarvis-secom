# Jarvis SECOM

AI chat assistant for SECOM marketing analytics. Query ad platform data across Meta, Google, TikTok, Amazon DSP, Kwai, LinkedIn and Pinterest using natural language.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4 |
| AI (text) | Groq (Llama, Mixtral) + Google (Gemini) via Vercel AI SDK |
| AI (voice) | Google Gemini 2.5 Flash TTS |
| Auth DB | PostgreSQL 18 + Drizzle ORM |
| Data warehouse | MySQL (`airbyte_secom`, read-only) |
| Email | Resend |
| Deployment | Vercel |

---

## Getting Started

### 1. Prerequisites

- Node.js 22+
- PostgreSQL 18 running (see below)
- API keys for Groq and Google Generative AI

### 2. Environment variables

Copy and fill in `.env.local`:

```bash
# AI providers
GOOGLE_GENERATIVE_AI_API_KEY=
GROQ_API_KEY=

# Data warehouse (MySQL — read-only)
MYSQL_HOST=
MYSQL_DATABASE=airbyte_secom
MYSQL_USER=
MYSQL_PASSWORD=

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
| `/login` | Email + password login |
| `/register` | Request access (requires admin approval) |
| `/waiting` | Shown after registration or when account is pending |
| `/` | Home menu — links to available tools |
| `/chat` | AI chat assistant |
| `/verification` | Verification dashboard (in progress) |
| `/admin` | User management (admin only) |

### Roles

| Role | Can access |
|---|---|
| `USER` | Home (`/`), Chat (`/chat`), Verification (`/verification`) |
| `ADMIN` | Home + Chat + Verification + Admin panel (`/admin`) |

### Session behaviour

- Sessions are stored in `sessions` table (PostgreSQL)
- Cookie: `jarvis_session_token` — HttpOnly, SameSite=Lax, Secure in production
- Sessions persist until the user logs out or an admin disables the account
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
| Multi-model | Switch between Groq and Gemini models in the header |
| SQL queries | AI generates and executes SELECT queries against `airbyte_secom` |
| Charts | AI renders bar/line charts on request |
| Voice mode | Speech recognition input + TTS audio response |
| Session persistence | Chat messages saved to Postgres per session |
| `⌘N` / `Ctrl+N` | Start a new chat session |

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

## Project Structure

```
app/
  (auth)/           # Login, register, waiting pages (no URL prefix)
  admin/            # Admin user management panel
  chat/             # AI chat page (/chat)
  verification/     # Verification dashboard (/verification — in progress)
  api/
    auth/           # register, login, logout, me
    admin/users/    # User list + enable/disable/edit
    chat/           # Main AI chat endpoint
    chat-sessions/  # Chat session CRUD + message persistence
    tts/            # Text-to-speech (Google Gemini)
  page.tsx          # Home menu — cards linking to available tools
components/
  ChatContainer     # Main chat UI + session management
  MenuCard          # Reusable card for home menu navigation
  UserMenu          # Name display + logout button
  MessageBubble     # Renders markdown + charts
  VoiceMode         # Speech recognition + TTS playback
lib/
  auth.ts           # getSession(), requireAuth(), requireAdmin()
  email.ts          # sendApprovalEmail() via Resend
  db/
    schema.ts       # Drizzle schema (users, sessions, chat_sessions, chat_messages)
    index.ts        # DB client singleton
    seed.ts         # Admin user seed script
proxy.ts            # Request guard — redirects unauthenticated requests to /login
```
