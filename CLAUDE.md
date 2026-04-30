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
4. SQL guard regex only allows `SELECT` on `gold_*` tables; blocks `INTO OUTFILE`, `LOAD_FILE`
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

## Verificação de Campanhas (`/verification`)

Rota **isolada** do chat — não compartilha estado, API ou lógica com `/chat`.

### Fluxo de 3 arquivos
1. **Consolidado** — template SECOM 29 colunas (gerado pelas agências via `TEMPLATE - Consolidado Verification.xlsx`)
2. **Comprovante(s)** — relatório de entrega do adserver (um ou mais arquivos `.xlsx`)
3. **Verification URL(s)** — arquivo de verification com categoria+URL por linha (opcional, um ou mais)

### Arquitetura de parsers por adserver
O usuário seleciona o adserver na UI. Cada adserver tem seu próprio módulo em `app/verification/parsers/`:

| Adserver | Módulo | Notas |
|---|---|---|
| 00px | `parser_00px.py` | Multi-sheet CPM+CPC+CPV, VA (IAB) viewability; verif tem layout multi-seção (ver nota abaixo) |
| ADFORCE | `parser_adforce.py` | Sheet única, viewability média ponderada, verif multi-sheet (pula ABAT); tolera células NaN no XML |
| ADMOTION | `parser_admotion.py` | Site (CM360) como veículo, Active View columns, URL Veiculada |
| AHEAD | `parser_ahead.py` | Mesmo formato CM360 do ADMOTION |
| METRIKE | `parser_metrike.py` | Sheet "Worksheet", linha #TOTAL POR CAMPANHA para contratado; viewability = viewables/impressões×100; comprovante tem subtotais por placement — ver nota abaixo |
| BRZ | `parser_brz.py` | Placeholder — `NotImplementedError` (adserver em ajuste) |

Cada parser exporta `parse_comprovante(filepath, data_ini, data_fim)` e `parse_verif(filepath, data_ini, data_fim)`.
Para adicionar novo adserver: criar `parser_X.py` com as duas funções e adicionar ao `PARSER_MAP` em `engine.py`.

### Subtotais em comprovantes (`parse_comprovante`)
Os comprovantes METRIKE e 00px contêm subtotais cujo label fica na **coluna Data** (não na coluna Veículo): `#TOTAL POR VEÍCULO`, `#TOTAL POR CANAL`, `Total por placement_id`. O guard de `#TOTAL` na coluna Veículo não os captura. Ambos os parsers descartam qualquer linha onde a coluna Data tem valor mas não é parseável como data — isso evita múltipla contagem independente de filtro de período.

### CPV e coluna `entregue` no consolidado
Para todos os tipos de compra (CPM, CPV), o engine lê `entregue` da **col 5 (Impressões)**. A col 9 (Views) é o numerador do VTR (views completos), não a métrica de entrega. Os parsers 00px CPV usam "Views" como sinônimo de total de plays = col 5.

### Comprovantes ADFORCE — CPV com colunas "Impressões" e "Entregues" separadas
Comprovantes CPV (ex.: TEADS) exportados pelo ADFORCE contêm **duas colunas distintas**:
- **Impressões** — exibições totais do anúncio (equivale ao `entregue` / col 5 do consolidado)
- **Entregues** — plays de vídeo (equivale ao `views` / col 9 do consolidado)
- **0%** — coluna de video plays que o parser mapeia para o campo `views`

O `parse_comprovante` prioriza "Impressões" para o campo `entregue`; só usa "Entregues" como fallback se "Impressões" não existir no cabeçalho.

### Tolerância a NaN no ADFORCE (`_load_workbook_safe`)
Alguns comprovantes ADFORCE contêm células `NaN` (resultado de `0/0` sem tratamento), que corrompem o XML do XLSX e fazem o openpyxl falhar. O `parser_adforce.py` usa `_load_workbook_safe()`: tenta carregar normalmente; se falhar, abre o arquivo como ZIP, remove `<v>NaN</v>` dos XMLs de worksheets e recarrega do buffer sanitizado.

### Datas como serial float (`parse_date` em `parser_utils.py`)
Quando openpyxl não reconhece o formato de data de uma célula (cell type `"n"` em vez de `"d"`), retorna o serial Excel como float (ex.: `46082.125` = 01/03/2026 03:00). `parse_date()` detecta floats no intervalo válido de datas Excel e converte via `openpyxl.utils.datetime.from_excel()`. Afeta todos os parsers que usam `parser_utils`.

### Layout multi-seção do arquivo de verification 00px
O arquivo de verification 00px tem duas linhas de cabeçalho (row 8 = seções, row 10 = colunas) e três seções de métricas na mesma sheet:
- **IMPRESSÕES | CPM** → col "Impressões" (preenchida apenas em linhas CPM)
- **CLIQUES | CPC** → col "Cliques"
- **VISUALIZAÇÕES | CPV** → col "Views" (preenchida apenas em linhas CPV)

`parse_verif` lê `impressoes = Impressões OR Views` por linha — usa o que não for zero. Isso garante que veículos CPV (ex.: Teads) tenham suas indevidas contadas corretamente.

**Atenção:** se o arquivo de verification incluir múltiplos Placement IDs, os totais de indevidas serão a soma de todos. Ex.: arquivo Teads com placements 152077 + 152078 soma ambos, mas o consolidado pode refletir apenas um deles — nesse caso a agência deve fornecer um arquivo filtrado por placement.

### Template 29 colunas (atualizado)
- Col 14: Conteúdo Sensível (novo — agregado geral)
- Cols 15–22: 8 categorias individuais (acidente, violencia, lingua_estrangeira, pornografia, safeframe, app_movel, teste_tag, nao_classificado)
- **Col 28**: Devolutiva BI SECOM (era col 27)
- Col 29: Devolutiva Agência

### CATEGORY_MAP centralizado
Em `app/verification/parsers/category_map.py` — único lugar para adicionar variantes de categoria.
Inclui strings compostas do ADFORCE (e.g. `"acidentes,violencia,crime"` sem espaços e `"pornografia, sexo, sexualidade"` → mapeados corretamente).

### Layouts de consolidado por adserver
Cada adserver pode usar um layout diferente de colunas no consolidado (posições de indevidas e devolutiva variam). O `engine.py` detecta as posições **dinamicamente** lendo o header da row 8 via `_detect_consolidado_cols(ws)`, que usa `normaliza_categoria()` para mapear nomes de colunas → chaves internas. Fallback para as constantes hardcoded do template padrão SECOM (29 colunas) quando o header não é reconhecido.

**ADFORCE** (confirmado em `/verification/ADFORCE/`):
- Col 14: `Acidentes,Violencia,Crime` (combinado; padrão tem Acidente=15, Violência=16)
- Col 15: `Língua Estrangeira` | Col 16: `Politica` | Col 17: `Sexo/Pornografia`
- Col 27: Devolutiva BI SECOM (padrão: 28) | Col 28: URL info (padrão: 30)

### Amostragem de URLs para AI check
- Parsers devolvem o pool completo de URLs indevidas (reservoir ≤ 500 por arquivo)
- `engine.py` agrupa por categoria e amostra **5% por categoria indevida** (mín. 1), cap global 200
- `route.ts` envia ao Ollama `gemma4:31b-cloud` em paralelo (máx 50 URLs, batches de 10)
- Retorna `url_check_anomalies: [{url, categoria, reason}]` para a UI
- Usa `OLLAMA_BASE_URL` — se ausente, URL check é silenciosamente pulado
- **Não duplo-amostrar**: parsers nunca fazem sub-amostragem própria

### Detecção de header nos parsers de verif
- `_find_verif_header` exige `"categoria"` + variant de `"veículo"` na mesma linha (até row 25)
- **Não exige coluna "url"** — URL é enriquecimento opcional, não obrigatório para detectar formato
- Arquivos sem coluna "Url" no header (ex: R7, UOL METRIKE) são parseados normalmente

### Passagem de múltiplos arquivos ao engine.py
- `route.ts` usa `args.push('--comp', ...compPaths)` e `args.push('--verif', ...verifPaths)`
- **Não** usar loop `for p of paths: args.push('--flag', p)` — argparse com `nargs` sobrescreve a cada flag repetida

### Devolutiva — formato das linhas
- `OK campo: valor` — campo OK (verde na UI)
- `DIV campo: comprovante X / consolidado Y` — divergência (vermelho)
- `? indevidas: sem arquivo de verification` — verif não enviado
- `PENDENTE: ...` — sem comprovante nem verif

### Viewability no consolidado
- Excel armazena como decimal (0.7166). `_read_consolidado` normaliza: se ≤ 1.0 → multiplica por 100

### Filtros disponíveis na UI
- **Ano**: chips ano−1 e ano atual — ao trocar com mês selecionado, recalcula `ini`/`fim`
- **Mês**: chips Jan–Dez preenchem `ini`/`fim` automaticamente com o ano selecionado
- **Range manual**: campos DD/MM/AAAA — desseleciona chip de mês ao editar

### PostgreSQL (produção e desenvolvimento)
- **Neon** (serverless Postgres) — projeto `jarvis-secom`, região `sa-east-1`
- Host: `ep-raspy-poetry-acxtgwu0.sa-east-1.aws.neon.tech` — SSL obrigatório (`ssl: 'require'`)
- A detecção de SSL é automática: `lib/db/index.ts` e `drizzle.config.ts` aplicam SSL quando o host contém `neon.tech`
- Vercel: **https://jarvis-app-v2.vercel.app**

### Deploy (on-prem Linux server via GitHub Actions)
Push to `master` triggers `.github/workflows/deploy.yml` which SSHs into the server and runs `deploy.sh`:
```bash
# deploy.sh on the server does:
git pull origin master
npm ci
.venv/bin/pip install -r requirements.txt --quiet
npm run build
sudo systemctl restart jarvis
```
Logs: `journalctl -u jarvis -f` on the server.

**One-time server setup** — see plan at `~/.claude/plans/what-if-we-put-dreamy-papert.md`:
- Ubuntu 24.04, Node.js 24 LTS, Python 3 venv with `openpyxl` + `rapidfuzz`
- Headscale (OSS VPN coordinator) for staff access — no user limit, no cost
- systemd unit at `/etc/systemd/system/jarvis.service` with `EnvironmentFile=/opt/jarvis_ui/.env.local`
- GitHub Actions secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`
