# Regras de Performance — SECOM (Médias Oficiais)

Benchmarks baseados nos dados reais de campanhas SECOM. Fonte primária: gold DB (jan/2025–abr/2026). Fonte secundária: documento oficial "Performance Digital — Indicadores de Desempenho" (Set/2025, Governo Federal).

---

## 1. Fórmulas Oficiais SECOM

| Sigla | Nome | Fórmula |
|---|---|---|
| **CPV** | Custo por Visualização | `SUM(cost) / SUM(visualizações)` |
| **CPM** | Custo por Mil Impressões | `SUM(cost) / SUM(impressões) × 1000` |
| **CPC** | Custo por Clique | `SUM(cost) / SUM(cliques totais)` |
| **CPE** | Custo por Engajamento | `SUM(cost) / SUM(engajamento)` |
| **CPA** | Custo por Alcance | `SUM(cost) / SUM(alcance)` |
| **CTR** | Taxa de Cliques | `SUM(cliques) / SUM(impressões) × 100` |
| **TPR** | Taxa do Thruplay | `SUM(viz. thruplay) / SUM(impressões) × 100` |
| **VTRc** | Taxa de Visualização Completa | `SUM(viz. completas) / SUM(impressões) × 100` |
| **VTR** | Taxa de Visualização | `SUM(viz. completas) / SUM(impressões) × 100` |
| **Taxa Eng.** | Taxa de Engajamento | `SUM(engajamento) / SUM(alcance) × 100` |
| **Frequência** | Frequência média | `SUM(impressões) / SUM(alcance)` |

---

## 2. Médias da SECOM por Plataforma e Objetivo

> Para CPV / CPC / CPM: **menor = melhor**.
> Para CTR / TPR / VTRc / VTR / Taxa Eng.: **maior = melhor**.

### Meta Ads (BRL)

Mapeamento de objetivo no gold DB: `THRUPLAY` → Visualizações | `REACH` → Alcance | `POST_ENGAGEMENT` → Engajamento | `LINK_CLICKS` → Tráfego

| Objetivo | CPV | TPR | VTRc | CPM | CPC | CPE | CTR |
|---|---|---|---|---|---|---|---|
| Visualizações (THRUPLAY) | R$0,06 | 12,19% | 4,87% | R$7,87 | — | — | 0,59% |
| Alcance (REACH) | — | — | — | R$2,21 | R$0,99 | — | 0,22% |
| Engajamento (POST_ENGAGEMENT) | — | — | — | R$8,04 | — | R$0,03 | 1,32% |
| Tráfego (LINK_CLICKS) | — | — | — | R$5,44 | R$0,35 | — | 1,57% |

**Notas Meta:**
- CPV calculado via `video_views` (vídeos com ≥15s)
- TPR = `video_views / impressions × 100`
- VTRc = `video_p100 / impressions × 100`
- Frequência ideal: entre **3 e 4** (alcance/engajamento) ou **2 e 3** (tráfego)

---

### Google Ads (BRL)

Mapeamento: `TARGET_CPV` → YouTube/Visualizações | `TARGET_SPEND` → Display | `MAXIMIZE_CONVERSIONS` → Search/Conversões | `TARGET_CPA` → Geração de Demanda

| Subtipo (objective) | CPV | TPR | CPM | CPC | CTR |
|---|---|---|---|---|---|
| YouTube/Viz (TARGET_CPV) | R$0,02 | 33,54% | R$7,29 | — | 0,18% |
| Display (TARGET_SPEND) | — | — | R$6,02 | R$0,24 | 2,46% |
| Search (MAXIMIZE_CONVERSIONS) | — | — | R$2,76 | R$0,47 | 0,58% |
| Geração de Demanda (TARGET_CPA) | — | — | R$3,47 | R$0,17 | 1,99% |

**Notas Google:**
- TPR (YouTube) = `video_views / impressions × 100` (visualizações até 30s ou completo)
- `video_p25/50/75/100` nas tabelas age/gender são taxas aproximadas (×impressions para contagens)
- CPV referência documento PDF: R$0,02 ✓ alinhado com gold DB

---

### Kwai Ads (BRL)

Mapeamento: `Community Interaction` → Visualizações | `Awareness` → Alcance | `Consideration` → Tráfego

| Objetivo | CPV (thruplays) | TPR | CPM | CPC | CTR |
|---|---|---|---|---|---|
| Visualizações (Community Interaction) | R$0,53 | 1,20% | R$6,35 | — | — |
| Alcance (Awareness) | R$0,18 | 1,76% | R$3,20 | — | 0,14% |
| Tráfego (Consideration) | R$0,13 | 3,11% | R$3,93 | R$0,87 | 0,45% |

**Notas Kwai:**
- CPV e TPR calculados via `video_completions` (thruplays ≥15s), não `video_views`
- SQL: `CPV = SUM(cost)/NULLIF(SUM(video_completions),0)` | `TPR = SUM(video_completions)/NULLIF(SUM(impressions),0)*100`
- Frequência ideal: entre **3 e 4**

---

### TikTok Ads (BRL)

Mapeamento: `VIDEO_VIEWS` → Visualizações | `REACH` → Alcance | `TRAFFIC` → Tráfego | `ENGAGEMENT` → Interação com Comunidade

| Objetivo | CPV | TPR | VTRc | CPM | CPC | CTR |
|---|---|---|---|---|---|---|
| Visualizações (VIDEO_VIEWS) | R$0,04 | 13,59% | 1,60% | R$5,38 | — | 0,23% |
| Alcance (REACH) | R$0,16 | 1,84% | 0,23% | R$2,99 | — | 0,17% |
| Tráfego (TRAFFIC) | R$0,28 | — | — | R$4,52 | R$0,15 | 3,08% |
| Interação (ENGAGEMENT) | — | — | — | R$10,28 | — | 0,06% |

**Notas TikTok:**
- CPV = `video_views / impressions` (visualizações ≥15s)
- VTRc = `video_p100 / impressions × 100`
- Frequência ideal (tráfego): entre **2 e 3**

---

### LinkedIn Ads (BRL equivalente — moeda varia por conta)

Mapeamento: `VIDEO_VIEW` → Visualizações | `BRAND_AWARENESS` → Alcance | `WEBSITE_VISIT` → Tráfego

| Objetivo | CPV | VTR (conclusões) | TPR (2s) | CPM | CPC | CTR |
|---|---|---|---|---|---|---|
| Visualizações (VIDEO_VIEW) | R$0,14 | 1,55% | 27,04% | R$37,51 | — | 0,46% |
| Alcance (BRAND_AWARENESS) | — | 1,51% | 13,15% | R$27,38 | — | 0,47% |
| Tráfego (WEBSITE_VISIT) | — | — | 3,03% | R$62,21 | R$4,00 | 1,55% |

**Notas LinkedIn:**
- CPV e VTR calculados via `video_completions` (conclusões = 97–100% do vídeo)
- SQL: `VTR = SUM(video_completions)/NULLIF(SUM(impressions),0)*100`
- TPR usa `video_views` (visualizações ≥2s com ≥50% na tela)
- LinkedIn reporta custo em moeda local da conta — gold DB já armazena em BRL
- Frequência ideal: entre **3 e 4**

---

### Pinterest Ads (BRL — custos já convertidos no gold DB)

Mapeamento: `AWARENESS` → Alcance | `CONSIDERATION` → Tráfego/Visitas ao Site | `VIDEO_COMPLETION` → Visualizações

| Objetivo | VTRc (p100) | CPM | CPC | CTR |
|---|---|---|---|---|
| Alcance (AWARENESS) | 0,47% | R$4,54 | — | 0,17% |
| Tráfego (CONSIDERATION) | — | R$6,33 | R$1,45 | 0,44% |
| Visualizações (VIDEO_COMPLETION) | 6,79% | R$15,12 | — | 0,26% |

**Notas Pinterest:**
- VTRc no gold DB = `video_p100 / impressions × 100` (100% de conclusão)
- O documento SECOM reporta VTR = 64,45% para Visualizações, mas usa a definição nativa da plataforma (≥2s com ≥50% visível). São métricas diferentes
- `pin_saved` (salvo) = sinal forte de intenção — monitorar junto com CTR
- Frequência ideal: entre **3 e 4**

---

### Amazon DSP (BRL — custos já convertidos no gold DB)

Não há benchmarks no documento PDF (Amazon não consta). Valores abaixo são médias gold DB (out/2025–abr/2026).

| Subtipo (objective) | CPM | VCR (video_p100) | CTR |
|---|---|---|---|
| Online Video | R$23,76 | 69,69% | 0,29% |
| Standard Display | R$6,26 | — | 0,16% |
| Streaming TV Video | R$65,91 | 58,26% | 0,76% |
| Audio | R$14,00 | — | 0,006% |

**Notas Amazon DSP:**
- VCR = `video_p100 / impressions × 100`
- Viewability ≥50% na tela como requisito mínimo
- CTR secundário — foco principal em CPM e VCR (brand awareness / retargeting)

---

### Twitch Ads (referência — SEM dados no gold DB)

Twitch não possui tabela em `airbyte_secom`. Os valores abaixo são do documento SECOM Set/2025 e servem apenas como referência externa.

| Objetivo | CPM | Taxa Visualização | CPV |
|---|---|---|---|
| Alcance | R$15,05 | 17,79% | R$0,03 |

---

## 3. Mapeamento de Colunas no Gold DB

```sql
-- Fórmulas SQL para gold_platforms_campaigns

CPV   = SUM(cost) / NULLIF(SUM(video_views), 0)
        -- exceção Kwai: SUM(cost) / NULLIF(SUM(video_completions), 0)
        -- exceção LinkedIn: SUM(cost) / NULLIF(SUM(video_completions), 0)

TPR   = SUM(video_views) / NULLIF(SUM(impressions), 0) * 100
        -- exceção Kwai: SUM(video_completions) / NULLIF(SUM(impressions), 0) * 100

VTRc  = SUM(video_p100) / NULLIF(SUM(impressions), 0) * 100
        -- exceção LinkedIn: SUM(video_completions) / NULLIF(SUM(impressions), 0) * 100

CPM   = SUM(cost) / NULLIF(SUM(impressions), 0) * 1000
CPC   = SUM(cost) / NULLIF(SUM(clicks), 0)
CTR   = SUM(clicks) / NULLIF(SUM(impressions), 0) * 100
CPE   = SUM(cost) / NULLIF(SUM(engagements), 0)
Taxa Eng = SUM(engagements) / NULLIF(SUM(reach), 0) * 100
```

### Disponibilidade por plataforma (gold_platforms_campaigns):

| Coluna | meta | google | tiktok | kwai | linkedin | pinterest | amazon |
|---|---|---|---|---|---|---|---|
| video_views | ✓ (15s) | ✓ | ✓ (15s) | — | ✓ (2s) | — | — |
| video_completions | — | — | — | ✓ (thruplays) | ✓ | — | — |
| video_p100 | ✓ | — | ✓ | — | — | ✓ | ✓ |
| reach | ✓ | — | ✓ | — | ✓ | ✓ | — |
| conversions | — | ✓ | ✓ | — | ✓ | — | — |
| link_clicks | ✓ | — | — | — | — | ✓ | — |

---

## 4. Notas Gerais

- **Todos os custos no gold DB estão em BRL** — inclusive Pinterest (cost_currency=USD no campo, mas valor convertido pelo ETL) e Amazon DSP
- **Objective NULL no gold DB**: Google e Amazon usam `objective IS NULL` para algumas campanhas sem objetivo mapeado
- **Atualização**: recalcular benchmarks trimestralmente com `WHERE date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)`
- **Frequência ideal geral**: 3–4 (awareness/engagement) | 2–3 (tráfego)
- Documento fonte: "Performance Digital — Indicadores de Desempenho" (Set/2025), Governo Federal / SECOM
