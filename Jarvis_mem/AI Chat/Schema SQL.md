---
title: Schema SQL — airbyte_secom
tags:
  - ai
  - sql
  - schema
  - gold
---

# Schema SQL — airbyte_secom

> [!tip] Jarvis usa somente tabelas `gold_`
> O agente tem acesso restrito a `SELECT` em tabelas `gold_*`. Tabelas `silver_` foram removidas do escopo do agente.

---

## Gold Layer

Ver detalhes completos em [[Gold Layer]].

### Tabelas

| Tabela | Grain |
|---|---|
| `gold_platforms_campaigns` | platform + campaign + ad + date + network |
| `gold_platforms_regions` | + region + country + city |
| `gold_platforms_age` | + age |
| `gold_platforms_gender` | + gender |
| `gold_platforms_age_gender` | + age + gender (análises cruzadas sem JOIN) |

### Colunas Compartilhadas

```sql
-- Identidade
id, platform, network, source_table, created_at, updated_at

-- Data
date DATE  -- sempre filtrar por esta coluna (YYYY-MM-DD)

-- Hierarquia
account_id, account_name, campaign_id, campaign_name,
ad_group_id, ad_group_name, ad_id, ad_name, objective

-- Custo (todos em BRL no DB)
cost DECIMAL(18,6), cost_currency

-- Performance
impressions, clicks, reach, engagements, conversions

-- Vídeo
video_views, video_p25, video_p50, video_p75, video_p100, video_completions
```

### KPIs

```sql
CPM  = SUM(cost)/NULLIF(SUM(impressions),0)*1000
CPC  = SUM(cost)/NULLIF(SUM(clicks),0)
CTR  = SUM(clicks)/NULLIF(SUM(impressions),0)*100
CPE  = SUM(cost)/NULLIF(SUM(engagements),0)
CPA  = SUM(cost)/NULLIF(SUM(conversions),0)
VCR  = SUM(video_p100)/NULLIF(SUM(impressions),0)*100

-- Vídeo avançado
CPV  = SUM(cost)/NULLIF(SUM(video_views),0)
       -- kwai/linkedin: usar video_completions no lugar de video_views
TPR  = SUM(video_views)/NULLIF(SUM(impressions),0)*100
       -- kwai: usar video_completions
VTRc = SUM(video_p100)/NULLIF(SUM(impressions),0)*100
       -- linkedin: usar video_completions
```

---

Ver também: [[Gold Layer]] · [[Performance Benchmarks]]
