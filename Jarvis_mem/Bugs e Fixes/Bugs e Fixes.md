---
title: Bugs e Fixes
tags:
  - bugs
  - fixes
  - histórico
---

# Log de Bugs e Fixes

## AI Chat

### AI descreve SQL em vez de executar
**Data:** Mar/2026
**Sintoma:** Modelos como Kimi K2, Qwen 3, Llama 4 Scout retornavam texto descrevendo o que fariam em vez de chamar a ferramenta.
**Causa:** System prompt dizia "Execute um SELECT" — ambíguo, modelos interpretavam como descrição, não como chamada de ferramenta.
**Fix:** `lib/agent.ts` — PROCESSO agora diz "CHAME OBRIGATORIAMENTE a ferramenta execute_sql_query. Você TEM acesso via essa ferramenta."
**Arquivo:** `lib/agent.ts` → PROCESSO regra 2

---

### Modelo gemini-3.0-flash retorna erro de API
**Data:** Abr/2026
**Sintoma:** `models/gemini-3.0-flash is not found for API version v1beta`
**Causa:** ID de modelo inválido — `gemini-3.0-flash` não existe na API Google.
**Fix:** Removidos `gemini-3.0-flash` e `gemini-3.1-flash-lite` da lista de modelos. Mantidos apenas `gemini-2.5-flash` e `gemini-2.5-flash-lite-preview-06-17`.
**Arquivo:** `lib/agent.ts` → MODELS[]

---

### Qwen 3 32B falha com TPM limit
**Data:** Abr/2026
**Sintoma:** `Request too large... Limit 6000, Requested 6271`
**Causa:** Groq free tier — Qwen 3 32B tem limite de 6000 TPM. System prompt + silver schema excede esse limite.
**Fix:** Nenhum no código — limitação de plataforma. Usar Llama 3.3 70B ou Gemini 2.5 Flash para conversas longas.

---

### AI filtra por campanha mesmo sem o usuário informar
**Data:** Abr/2026
**Sintoma:** Query retorna vazio quando usuário pergunta sobre melhor performance sem especificar campanha.
**Causa:** Modelos adicionavam filtros implícitos.
**Fix:** `lib/agent.ts` → Regra 7: "Se o usuário NÃO especificar campanha, NÃO adicione filtro — consulte TODAS."

---

## Verificação — 00px

### Dupla contagem de subtotais
**Data:** Mar/2026
**Sintoma:** Totais de impressões inflados no comprovante 00px.
**Causa:** Subtotais (`#TOTAL POR VEÍCULO`, `#TOTAL POR CANAL`) têm label na **coluna Data** — o guard de `#TOTAL` na coluna Veículo não os capturava. O date filter não descartava essas linhas porque `None` não é string com `#TOTAL`.
**Fix:** `parser_00px.py` — descarta qualquer linha onde coluna Data tem valor mas não é parseável como data.

---

### CPV lendo coluna errada
**Data:** Mar/2026
**Sintoma:** Divergências falsas em campanhas CPV — entregue errado.
**Causa:** Parser lia coluna "Impressões" para CPV, mas CPV usa coluna "Views" como métrica de plays.
**Fix:** `parser_00px.py` — `parse_verif` lê `impressoes = Impressões OR Views` (usa o que não for zero).

---

## Verificação — METRIKE

### Date filter retornava todas as datas
**Data:** Mar/2026
**Sintoma:** Verificações de dezembro mostravam divergências falsas.
**Causa:** Subtotais com string na coluna Data (`Total por placement_id`) bypassavam o date filter — o código tentava fazer parse sem verificar `None` primeiro.
**Fix:** `parser_metrike.py` — verifica `None` antes de tentar parse, descarta linha se não parseável.

---

### Double-counting de subtotais por placement
**Data:** Mar/2026
**Sintoma:** Mesma causa acima — subtotais eram somados junto com os dados reais.
**Fix:** Mesmo fix do date filter — linhas com Data não parseável são descartadas.

---

### TypeError na detecção de header
**Data:** Mar/2026
**Sintoma:** `TypeError: 'list' object cannot be interpreted as a set`
**Causa:** `lows` era lista — incompatível com operação de set intersection usada na detecção de header.
**Fix:** `parser_metrike.py` — `lows` convertido para `set`.

---

## Verificação — Engine

### indevidas retornando zero com verif enviado
**Data:** Mar/2026
**Sintoma:** Categorias indevidas zeradas mesmo com arquivo de verification presente.
**Fix:** `engine.py` — múltiplos fixes: URL sampling movido do parser para o engine, pool de URLs completo retornado pelos parsers.

---

### Sexo e Sexualidade mapeada para Pornografia
**Data:** Mar/2026
**Sintoma:** Categoria "sexo e sexualidade" contava em pornografia em vez de coluna própria.
**Fix:** Nova coluna `sexo_sexualidade` (col 19) adicionada ao template 30 colunas. Colunas seguintes shiftadas. Atualizado `engine.py` (COL_INDEVIDAS) e `category_map.py`.
