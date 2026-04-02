---
title: Arquitetura
tags:
  - projeto
  - arquitetura
---

# Arquitetura

## Dual-Database Pattern

```
┌─────────────────────────────────────────────────────┐
│                    Next.js App                      │
│                                                     │
│  ┌──────────────────┐    ┌───────────────────────┐  │
│  │   PostgreSQL      │    │   MySQL (read-only)   │  │
│  │   (Drizzle ORM)  │    │   airbyte_secom       │  │
│  │                  │    │                       │  │
│  │  • users         │    │  • gold_platforms_*   │  │
│  │  • sessions      │    │  • silver_*           │  │
│  │  • chatSessions  │    │                       │  │
│  │  • chatMessages  │    │  7 plataformas de     │  │
│  │                  │    │  mídia digital        │  │
│  └──────────────────┘    └───────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

> [!warning] Nunca misture os dois clientes
> `lib/auth.ts` + `lib/db/` → PostgreSQL
> `lib/mysql.ts` → MySQL analytics
> São clients separados. Não confunda.

## Autenticação

- Tokens: strings hex 64 bytes, armazenados na tabela `sessions`
- Cookie: `jarvis_session_token`
- Middleware `proxy.ts` valida antes de todas as rotas protegidas
- Expiração: 30 dias
- Desabilitar usuário → invalida todas as sessões imediatamente

**Helpers:**
- `requireAuth()` → rota protegida (USER+)
- `requireAdmin()` → rota admin-only
- Ambos jogam redirect em caso de falha

## Routing

```
(auth)/
  login       ← público
  register    ← público
  waiting     ← público

/             ← requireAuth
/chat         ← requireAuth
/verification ← requireAuth
/admin        ← requireAdmin
```

## AI Chat Pipeline

```
1. POST /api/chat
      ↓
2. getSystemPrompt()   ← schema SQL + regras + data atual
      ↓
3. generateText() [Vercel AI SDK]
   + tool: execute_sql_query
   + stopWhen: stepCountIs(6)
      ↓
4. LLM chama execute_sql_query({ sql_query })
      ↓
5. SQL guard regex (bloqueia INTO OUTFILE, LOAD_FILE)
      ↓
6. pool.query(sql) → MySQL analytics
      ↓
7. Sanitiza pipe chars (| → ∣) para não quebrar markdown
      ↓
8. LLM formata resposta + opcional CHART_REQUEST:{...}
      ↓
9. parseChartRequest() separa texto do JSON do gráfico
      ↓
10. { output, chartData } → cliente
```

## Charts

O AI não retorna dados estruturados para gráficos — embute um sentinel no texto:

```
CHART_REQUEST:{"type":"bar","title":"...","labels":[...],"datasets":[...]}
```

`MessageBubble.tsx` detecta e passa para `ChartWidget.tsx` (Recharts).
Tipos suportados: `"bar"` e `"line"`.

## Voice Mode

`VoiceMode.tsx` importado com `dynamic(..., { ssr: false })` — obrigatório porque usa Web Speech API (browser-only). TTS via Google Gemini 2.5 Flash → `/api/tts`.

---

Ver também: [[Pipeline do Chat]] · [[Setup e Comandos]]
