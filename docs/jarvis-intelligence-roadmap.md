# Jarvis Intelligence Roadmap

> Analysis from 2026-06-09. Reference: `Framework Performance Analysis v4.md`.

---

## The Real Problem First

Before any ML investment, there's a structural gap: **the Framework v4 taxonomy (7 creative dimensions + media metadata) almost certainly isn't in the data warehouse**. Jarvis queries `gold_platforms_campaigns`, which has impressions, clicks, cost, platform, campaign name — but probably not `eixo_tematico`, `elemento_visual`, `tom_mensagem`, or the composite creative code like `TRB_E61_VIDEO_30S_MEM_CEL_ATO`.

**First question to answer: is the Framework v4 taxonomy stored in the DB, or does it only live in spreadsheets?**

If it doesn't exist as columns, no amount of LLM intelligence fixes the cross-dimensional analysis the framework is designed for.

---

## On Fine-tuning Gemma 4 — Why It's the Wrong Lever

Fine-tuning a 31B model is almost certainly not the right answer:

- Requires serious GPU infra (A100s, weeks of work, labeled training data you don't have yet)
- The domain changes: new programs (`IR`, `PDM`), new creative codes — fine-tuned knowledge goes stale quickly
- Gemma 4 already understands Portuguese, SQL, and analytics reasoning
- **The bottleneck is context quality, not model intelligence**

Enormous effort for marginal gains on the wrong layer.

---

## What Would Actually Work (in order of Performance)

### 1. Fix the System Prompt with Full Framework v4 Taxonomy
**Effort: low | Impact: high**

`lib/agent.ts` currently has a generic system prompt + 7 hardcoded SQL examples. Adding the creative dimension dictionary (the tables from Framework v4 Section 2) as structured context would immediately let Gemma 4 answer questions like "which `tom da mensagem` performs best for Pé de Meia?" — zero ML work required.

### 2. Few-shot RAG for SQL Examples
**Effort: medium | Impact: high**

Store a library of 30–50 `(question → correct SQL)` pairs covering the cross-dimensional analysis patterns from Framework v4 Section 3. When a user asks something, retrieve the 3 most similar examples via a lightweight embedding model (e.g., `nomic-embed-text` running on Ollama), inject them into the prompt.

The current 7 hardcoded examples in `agent.ts` are a static, poor approximation of this. This is the ML that actually makes sense here — semantic search, no training required.

### 3. Query Templates for Canonical Framework Analyses
**Effort: medium | Impact: high**

Sections 3.2–3.4 of the framework define specific analysis patterns:

| Pattern | Example |
|---|---|
| Eixo × Visual | "For SAÚDE, does BENEFICIÁRIO or DADOS perform better?" |
| Programa × Porta-voz | "Does influencer outperform narração off for Pé de Meia?" |
| Tom × Posicionamento | "Does EMO work better in Feed or Reels?" |
| Segundagem × Visual | "Do memes work better at 15s or 30s?" |

Pre-write parameterized SQL templates for each. Have the LLM classify intent and fill parameters rather than generating SQL from scratch. Far more reliable than open-ended generation.

### 4. Creative Metadata in the DB
**Effort: high | Impact: critical (prerequisite for cross-dimensional analysis)**

If creative codes aren't in the warehouse, build a mapping table:

```sql
CREATE TABLE creative_classifications (
  creative_code VARCHAR(60) PRIMARY KEY,  -- e.g. TRB_E61_VIDEO_30S_MEM_CEL_ATO
  eixo          VARCHAR(10),              -- TRB
  programa      VARCHAR(10),             -- E61
  formato       VARCHAR(20),             -- VIDEO
  segundagem    VARCHAR(5),              -- 30S
  visual        VARCHAR(10),             -- MEM
  tom           VARCHAR(10),             -- CEL
  porta_voz     VARCHAR(10)              -- ATO
);
```

This is a data engineering task, not an AI task. Without it, the framework's cross-dimensional analysis is impossible regardless of LLM capability.

---

## Recommended Architecture

```
User question
     ↓
[Intent classifier] — is this a cross-dimensional creative analysis?
     ↓
[RAG retrieval] — fetch 3 similar past queries + their SQL
     ↓
[Template selector] — does a Section 3.2/3.3 pattern template fit?
     ↓
Gemma 4 (current) — fills in parameters or generates SQL
     ↓
SQL guard → MySQL warehouse
```

The "ML" here is the embedding model for RAG retrieval — small, fast, runs on the existing Ollama instance, no training required.

---

## Priority Roadmap

### This Week (no infra change)
- [ ] Inject full Framework v4 taxonomy (dimension dictionaries) into `lib/agent.ts` system prompt
- [ ] Add 20+ cross-dimensional SQL examples to the few-shot section of `agent.ts`
- [ ] Verify whether creative classification columns exist in `gold_platforms_campaigns`

### Medium Term
- [ ] Build few-shot RAG using Ollama embeddings (`nomic-embed-text`)
- [ ] Build query template library for Section 3.2–3.4 analysis patterns
- [ ] Create a `/api/similar-queries` endpoint backed by embeddings store

### Long Term
- [ ] Add `creative_classifications` mapping table to the warehouse if metadata is missing
- [ ] Consider a lightweight intent classifier (small model or rules-based) to route queries to templates vs. free-form generation
- [ ] Evaluate whether Gemma 4 should be swapped for a model with longer context window as the system prompt grows

---

## Key Principle

> Gemma 4 is already capable of the analysis the framework demands — it just doesn't have the right context. Fixing the prompt and adding RAG with embeddings gets 80% of the intelligence gain with 10% of the effort of fine-tuning.
