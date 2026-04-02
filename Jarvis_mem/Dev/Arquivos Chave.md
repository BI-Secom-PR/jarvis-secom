---
title: Arquivos Chave
tags:
  - dev
  - arquitetura
---

# Arquivos Chave

## Core

| Arquivo | Propósito |
|---|---|
| `lib/db/schema.ts` | Schema Drizzle: users, sessions, chatSessions, chatMessages |
| `lib/auth.ts` | `getSession()`, `requireAuth()`, `requireAdmin()` |
| `lib/mysql.ts` | MySQL pool + SQL guard (bloqueia não-SELECT, INTO OUTFILE) |
| `proxy.ts` | Middleware Next.js — valida sessão antes de rotas protegidas |

## AI Chat

| Arquivo | Propósito |
|---|---|
| `lib/agent.ts` | Modelos disponíveis, system prompt completo (schema SQL + skill de performance) |
| `performance_rules.md` | Benchmarks SECOM por plataforma+objetivo (fonte para o system prompt) |
| `app/api/chat/route.ts` | Endpoint principal — Vercel AI SDK, tool execute_sql_query |
| `components/ChatContainer.tsx` | Estado do chat no cliente |
| `components/MessageBubble.tsx` | Detecta CHART_REQUEST:{...} no texto |
| `components/ChartWidget.tsx` | Renderiza Recharts a partir do chartData |
| `components/VoiceMode.tsx` | Voice mode (dynamic import, ssr: false) |

## Verificação

| Arquivo | Propósito |
|---|---|
| `app/verification/engine.py` | Motor principal — lê consolidado, chama parsers, gera devolutiva |
| `app/verification/parsers/category_map.py` | Mapeamento centralizado de categorias indevidas |
| `app/verification/parsers/parser_00px.py` | Parser 00px (CPM/CPC/CPV, multi-seção) |
| `app/verification/parsers/parser_adforce.py` | Parser ADFORCE (viewability ponderada) |
| `app/verification/parsers/parser_admotion.py` | Parser ADMOTION (CM360) |
| `app/verification/parsers/parser_ahead.py` | Parser AHEAD (mesmo formato CM360) |
| `app/verification/parsers/parser_metrike.py` | Parser METRIKE (Worksheet, subtotais) |
| `app/verification/parsers/parser_brz.py` | Parser BRZ (placeholder — NotImplementedError) |
| `app/api/verification/run/route.ts` | Endpoint — spawn engine.py + AI URL check (Groq) |
| `components/VerificationContainer.tsx` | UI de verificação |

## Dados (não são código)

```
verification/   ← planilhas Excel (templates e exemplos)
```

---

Ver também: [[Arquitetura]] · [[Fluxo de Verificação]]
