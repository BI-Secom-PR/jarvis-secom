---
title: Pipeline do Chat
tags:
  - ai
  - chat
  - pipeline
---

# Pipeline do Chat

## Arquivo principal
`app/api/chat/route.ts`

## Fluxo

```
Cliente envia: { chatInput, messages[], model }
      ↓
Valida sessão (requireAuth via getSession)
      ↓
Resolve modelo (Groq ou Google por provider)
      ↓
generateText({
  model,
  system: getSystemPrompt(),   ← schema + regras + data atual
  messages: [...history, user],
  stopWhen: stepCountIs(6),    ← máx 6 steps (tool calls + resposta)
  tools: { execute_sql_query }
})
      ↓
LLM decide chamar execute_sql_query({ sql_query })
      ↓
  SQL guard: bloqueia INTO OUTFILE, LOAD_FILE, não-SELECT
      ↓
  pool.query(sql) → airbyte_secom
      ↓
  sanitiza pipes (| → ∣)
      ↓
  retorna rows ao LLM
      ↓
LLM formata resposta final
      ↓
parseChartRequest() separa texto de CHART_REQUEST:{...}
      ↓
{ output: string, chartData: ChartData | null }
```

## Tool: execute_sql_query

```typescript
tool({
  description: 'Executes SELECT on gold_* or silver_* tables',
  inputSchema: z.object({ sql_query: z.string() }),
  execute: async ({ sql_query }) => { ... }
})
```

> [!important] O LLM DEVE usar a ferramenta
> O system prompt instrui explicitamente: "CHAME OBRIGATORIAMENTE a ferramenta execute_sql_query". Sem isso, modelos como Kimi K2 e Qwen 3 descrevem a query em vez de executar.

## Regras de negócio no System Prompt

1. Somente `gold_` ou `silver_` tables
2. Somente SELECT
3. LIMIT 500 (padrão)
4. Recusa modificações de dados
5. LIKE '%termo%' para nomes textuais (nunca igualdade exata)
6. Query vazia → informar, não inventar
7. Sem filtro de campanha → consulta TODAS, retorna rankeado

## Formatação de saída

- Números BR: `1.234.567` / `R$ 1.234,56`
- Tabelas markdown com cabeçalhos exatos do SQL
- Pipe nos valores → substituir por `∣` (U+2223)

---

Ver também: [[Modelos de IA]] · [[Schema SQL]]
