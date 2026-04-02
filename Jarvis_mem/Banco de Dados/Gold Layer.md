---
title: Gold Layer
tags:
  - banco-de-dados
  - gold
  - mysql
---

# Gold Layer — airbyte_secom

Dados normalizados cross-platform. Use para comparações entre plataformas e dashboards gerais.

## Tabelas

| Tabela | Grain | Notas |
|---|---|---|
| `gold_platforms_campaigns` | platform+campaign+ad+date+network | Tem `link_clicks` (exclusivo) |
| `gold_platforms_regions` | +region+country+city | Tem `region_id`, `region_type`, `region_name`, `country` |
| `gold_platforms_age` | +age | `ad_id=''` para Google (nível ad_group) |
| `gold_platforms_gender` | +gender | `ad_id=''` para Google |
| `gold_platforms_age_gender` | +age+gender | Análises cruzadas sem JOIN; ver dimensões abaixo |

## Colunas Compartilhadas

```sql
-- Identidade
id, platform, network, source_table, created_at, updated_at

-- Tempo
date DATE  -- YYYY-MM-DD, sempre filtrar por aqui

-- Hierarquia
account_id, account_name, campaign_id, campaign_name,
ad_group_id, ad_group_name, ad_id, ad_name, objective

-- Custo
cost DECIMAL(18,6), cost_currency

-- Performance
impressions, clicks, reach, engagements, conversions

-- Social
likes, comments, shares, reactions (Meta only), saves

-- Vídeo
video_views, video_plays, video_2s, video_30s,
video_p25, video_p50, video_p75, video_p95, video_p100, video_completions
```

## Valores da Coluna `platform`

```
'meta' | 'google' | 'tiktok' | 'kwai' | 'linkedin' | 'pinterest' | 'amazon_dsp'
```

## Dimensões por Tabela

### age (gold_platforms_age)
```
meta/kwai:  '13-17','18-24','25-34','35-44','45-54','55-64','65+'
google:     'AGE_18_24','AGE_25_34','AGE_35_44','AGE_45_54','AGE_55_64','AGE_65_UP','UNDETERMINED'
tiktok:     'AGE_13_17','AGE_18_24','AGE_25_34','AGE_35_44','AGE_45_54','AGE_55_100'
```

### gender (gold_platforms_gender)
```
meta/kwai:  'male','female','unknown'
google:     'MALE','FEMALE','UNDETERMINED'
tiktok:     'MALE','FEMALE','OTHER'
```

### age_gender (gold_platforms_age_gender) — ambas as dimensões por linha
```
meta:   age '13-17'…'65+'/'Unknown'  |  gender 'female'/'male'/'unknown'
kwai:   age '<17'/'18-24'/'25-36'/'37-50'/'>50'/'Unknown'  |  gender 'Female'/'Male'/'Unknown'
google: age 'AGE_RANGE_18_24'…'AGE_RANGE_UNDETERMINED'  |  gender 'FEMALE'/'MALE'/'UNDETERMINED'
tiktok: age 'AGE_13_17'…'AGE_55_100'/'NONE'  |  gender 'FEMALE'/'MALE'/'NONE'
```
> [!note] Colunas ausentes vs `campaigns`: `reactions`, `saves`, `link_clicks`, `video_2s`, `video_30s`, `video_p95`, `video_completions`

## Disponibilidade de Métricas

| Métrica | Disponível em |
|---|---|
| link_clicks | meta✓, pinterest✓ — demais=0 (só em campaigns) |
| reach | meta✓, tiktok✓, linkedin✓, pinterest✓ — google=0, kwai=0, amazon=0 |
| conversions | google✓, tiktok✓, linkedin✓ — demais=0 |
| reactions | meta✓ — demais=0 |
| video_p25/50/75/100 | meta✓, tiktok✓, pinterest✓, amazon✓ — kwai=0, linkedin=0 |
| video_completions | kwai✓(thruplays), linkedin✓ — demais=0 |

## Moeda (cost)

> [!success] Todos os custos no gold DB estão em BRL
> O ETL converte os valores antes de carregar. O campo `cost_currency` pode indicar `'USD'` para Pinterest/Amazon mas o valor de `cost` já está em BRL.

| Plataforma | cost_currency | Valor em |
|---|---|---|
| meta, google, tiktok | NULL | BRL |
| kwai | 'BRL' | BRL |
| linkedin | varia por conta | BRL |
| pinterest | 'USD' | BRL (convertido pelo ETL) |
| amazon_dsp | NULL ou 'BRL' | BRL (convertido pelo ETL) |

---

Ver também: [[Silver Layer]] · [[Schema SQL]]
