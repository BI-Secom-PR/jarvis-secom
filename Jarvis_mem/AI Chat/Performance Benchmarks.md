---
title: Performance Benchmarks — Skill de Performance
tags:
  - ai
  - performance
  - kpi
  - benchmarks
---

# Performance Benchmarks — Skill de Performance

Jarvis possui uma **skill de performance** embutida no system prompt. Quando o usuário pede análise ou comparação de campanhas, o agente detecta automaticamente a plataforma + objetivo e compara os KPIs calculados contra as médias oficiais da SECOM.

Fonte dos benchmarks: gold DB (jan/2025–abr/2026) + documento oficial **"Performance Digital — Indicadores de Desempenho"** (Set/2025, Governo Federal).
Arquivo de referência completo: `performance_rules.md` na raiz do projeto.

---

## Como a Skill Funciona

```
1. DETECTE  →  SELECT DISTINCT platform, objective FROM ...
2. CALCULE  →  KPIs da campanha (CPV, TPR, VTRc, CPM, CPC, CTR)
3. COMPARE  →  vs médias SECOM abaixo
4. ENTREGUE →  tabela: KPI | Valor | Média SECOM | Avaliação
```

**Classificação:**
- `acima da média` — CPV/CPC/CPM mais baixo **ou** CTR/TPR/VTRc mais alto que o benchmark
- `na média` — dentro de ±20%
- `abaixo da média` — pior que o benchmark

---

## Médias da SECOM por Plataforma e Objetivo

> Todos os valores em BRL. Custos do gold DB já estão convertidos.

### Meta Ads
| Objetivo (gold `objective`) | CPV | TPR | VTRc | CPM | CPC | CPE | CTR |
|---|---|---|---|---|---|---|---|
| Visualizações (THRUPLAY) | R$0,06 | 12,19% | 4,87% | R$7,87 | — | — | 0,59% |
| Alcance (REACH) | — | — | — | R$2,21 | R$0,99 | — | 0,22% |
| Engajamento (POST_ENGAGEMENT) | — | — | — | R$8,04 | — | R$0,03 | 1,32% |
| Tráfego (LINK_CLICKS) | — | — | — | R$5,44 | R$0,35 | — | 1,57% |

### Google Ads
| Subtipo (gold `objective`) | CPV | TPR | CPM | CPC | CTR |
|---|---|---|---|---|---|
| YouTube/Viz (TARGET_CPV) | R$0,02 | 33,54% | R$7,29 | — | 0,18% |
| Display (TARGET_SPEND) | — | — | R$6,02 | R$0,24 | 2,46% |
| Search (MAXIMIZE_CONVERSIONS) | — | — | R$2,76 | R$0,47 | 0,58% |
| GDN/Demanda (TARGET_CPA) | — | — | R$3,47 | R$0,17 | 1,99% |

### Kwai Ads
> CPV e TPR calculados via `video_completions` (thruplays)

| Objetivo | CPV | TPR | CPM | CPC | CTR |
|---|---|---|---|---|---|
| Visualizações (Community Interaction) | R$0,53 | 1,20% | R$6,35 | — | — |
| Alcance (Awareness) | R$0,18 | 1,76% | R$3,20 | — | 0,14% |
| Tráfego (Consideration) | R$0,13 | 3,11% | R$3,93 | R$0,87 | 0,45% |

### TikTok Ads
| Objetivo | CPV | TPR | VTRc | CPM | CPC | CTR |
|---|---|---|---|---|---|---|
| Visualizações (VIDEO_VIEWS) | R$0,04 | 13,59% | 1,60% | R$5,38 | — | 0,23% |
| Alcance (REACH) | R$0,16 | 1,84% | 0,23% | R$2,99 | — | 0,17% |
| Tráfego (TRAFFIC) | R$0,28 | — | — | R$4,52 | R$0,15 | 3,08% |

### LinkedIn Ads
> CPV e VTR via `video_completions` (conclusões ≥97%)

| Objetivo | CPV | VTR | TPR (2s) | CPM | CPC | CTR |
|---|---|---|---|---|---|---|
| Visualizações (VIDEO_VIEW) | R$0,14 | 1,55% | 27,04% | R$37,51 | — | 0,46% |
| Alcance (BRAND_AWARENESS) | — | 1,51% | 13,15% | R$27,38 | — | 0,47% |
| Tráfego (WEBSITE_VISIT) | — | — | 3,03% | R$62,21 | R$4,00 | 1,55% |

### Pinterest Ads
| Objetivo | VTRc (p100) | CPM | CPC | CTR |
|---|---|---|---|---|
| Alcance (AWARENESS) | 0,47% | R$4,54 | — | 0,17% |
| Tráfego (CONSIDERATION) | — | R$6,33 | R$1,45 | 0,44% |
| Visualizações (VIDEO_COMPLETION) | 6,79% | R$15,12 | — | 0,26% |

> [!note] VTR Pinterest
> O doc SECOM reporta VTR = 64,45% usando a definição nativa da plataforma (≥2s + 50% visível).
> O gold DB computa `video_p100/impressions` (100% conclusão) — métrica diferente e naturalmente mais baixa.

### Amazon DSP
| Subtipo (gold `objective`) | CPM | VCR (p100) | CTR |
|---|---|---|---|
| Online Video | R$23,76 | 69,69% | 0,29% |
| Standard Display | R$6,26 | — | 0,16% |
| Streaming TV Video | R$65,91 | 58,26% | 0,76% |
| Audio | R$14,00 | — | 0,006% |

### Twitch *(referência apenas — sem dados no gold DB)*
| Objetivo | CPM | Taxa Viz | CPV |
|---|---|---|---|
| Alcance | R$15,05 | 17,79% | R$0,03 |

---

## Fórmulas Oficiais SECOM

| Sigla | Fórmula |
|---|---|
| CPV | `SUM(cost) / SUM(visualizações)` |
| CPM | `SUM(cost) / SUM(impressões) × 1000` |
| CPC | `SUM(cost) / SUM(cliques)` |
| CPE | `SUM(cost) / SUM(engajamento)` |
| CTR | `SUM(cliques) / SUM(impressões) × 100` |
| TPR | `SUM(viz. thruplay) / SUM(impressões) × 100` |
| VTRc | `SUM(viz. completas) / SUM(impressões) × 100` |
| Taxa Eng. | `SUM(engajamento) / SUM(alcance) × 100` |

---

Ver também: [[Schema SQL]] · [[Gold Layer]]
