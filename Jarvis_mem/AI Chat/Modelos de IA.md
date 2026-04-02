---
title: Modelos de IA
tags:
  - ai
  - modelos
  - groq
  - google
---

# Modelos de IA

Definidos em `lib/agent.ts` → `MODELS[]`.
Modelo padrão: **Llama 3.3 · 70B** (`llama-3.3-70b-versatile`).

## Modelos Disponíveis

| ID | Label | Provider | Notas |
|---|---|---|---|
| `llama-3.3-70b-versatile` | Llama 3.3 · 70B | Groq | **Padrão** — melhor tool calling |
| `llama-3.1-8b-instant` | Llama 3.1 · 8B | Groq | Rápido, menos confiável em tool use |
| `meta-llama/llama-4-scout-17b-16e-instruct` | Llama 4 Scout · 17B | Groq | Tool calling moderado |
| `moonshotai/kimi-k2-instruct` | Kimi K2 | Groq | Tool calling fraco sem instrução explícita |
| `qwen/qwen3-32b` | Qwen 3 · 32B | Groq | TPM muito baixo no free tier (~6000) |
| `gemini-2.5-flash` | Gemini 2.5 Flash | Google | Bom — também usado para TTS |
| `gemini-2.5-flash-lite-preview-06-17` | Gemini 2.5 Flash Lite | Google | Mais leve |

> [!warning] Modelos removidos
> `gemini-3.0-flash` e `gemini-3.1-flash-lite` foram removidos — não existem na API Google v1beta e causavam erro `model not found`.

## Tradeoffs

### Tool Calling
- **Confiável:** Llama 3.3 70B, Gemini 2.5 Flash
- **Fraco sem instrução explícita:** Kimi K2, Qwen 3, Llama 4 Scout
- **Fix aplicado:** system prompt agora diz "CHAME OBRIGATORIAMENTE a ferramenta execute_sql_query" — ver [[Pipeline do Chat]]

### Rate Limits (Groq free tier)
- Qwen 3 32B: **6000 TPM** — falha quando o system prompt + conversa > 6271 tokens
- Solução: usar Llama 3.3 70B ou Gemini para conversas longas

### Providers
```typescript
// lib/agent.ts
function resolveModel(id: ModelId) {
  return getModelProvider(id) === 'google' ? google(id) : groq(id);
}
```

## TTS
`/api/tts` usa **Gemini 2.5 Flash** diretamente (não passa pelo seletor de modelo do chat).

---

Ver também: [[Pipeline do Chat]]
