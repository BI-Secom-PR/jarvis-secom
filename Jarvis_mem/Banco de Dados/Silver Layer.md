---
title: Silver Layer
tags:
  - banco-de-dados
  - silver
  - mysql
---

# Silver Layer — airbyte_secom

Dados nativos por plataforma, antes da normalização cross-platform.

> [!tip] Use silver quando precisar de
> TikTok: follows, music_clicks, vta/cta conversions
> LinkedIn: leads, spend_in_usd
> Facebook: publisher_platform (facebook/instagram/audience_network)
> Pinterest: métricas orgânicas separadas
> Google: video como contagem (rate × impressions)
> Kwai: thruplays, agency, file_name

## Hierarquia Comum

```sql
date DATE, account_id, account_name, campaign_id, campaign_name,
ad_group_id, ad_group_name, ad_id, ad_name
```

---

## Amazon (`total_cost` USD)

### silver_amazon_ads_audience
Dims extras: `segment`, `targeting_method`
Métricas: impressions, clicks, video_p25/p50/p75/p100

### silver_amazon_ads_campaign
Dims extras: `creative_id`
Métricas: impressions, clicks, **viewable_impressions**, video_p25/p50/p75/p100

### silver_amazon_ads_region
Dims extras: `city`, `country`, `region`
Métricas: impressions, clicks, video_p25/p50/p75/p100

---

## Facebook/Meta (`spend` BRL)

### silver_facebook_ads_age_gender
Dims extras: `age`, `gender`
Métricas: clicks, impressions, reach, engagements, reactions, likes, comments, shares, video_15s, video_30s, video_p25/p50/p75/p100

### silver_facebook_ads_campaign_platform
Dims extras: `publisher_platform` → `'facebook'|'instagram'|'audience_network'|'messenger'`
Métricas: mesmas + **video_plays**

### silver_facebook_ads_region
Dims extras: `region`
Métricas: mesmas que age_gender (sem video_plays)

---

## Google (`cost` BRL)

> [!warning] Vídeo armazenado como taxa
> `video_p25_rate`, `video_p50_rate`, `video_p75_rate`, `video_p100_rate` são decimais (0.45 = 45%).
> Para contagens absolutas: `ROUND(video_pXX_rate * impressions)`
> O gold layer já faz essa conversão.

### silver_google_ads_campaigns
Dims extras: `ad_id`, `ad_type`
Métricas: clicks, impressions, engagements, conversions, video_views, video_p25_rate/p50_rate/p75_rate/p100_rate

### silver_google_ads_age
Dims extras: `age_type` → `AGE_18_24|AGE_25_34|AGE_35_44|AGE_45_54|AGE_55_64|AGE_65_UP|UNDETERMINED`
Métricas: clicks, impressions, video_views, video_pXX_rate

### silver_google_ads_gender
Dims extras: `gender_type` → `MALE|FEMALE|UNDETERMINED`
Métricas: mesmas que age + **all_conversions**

### silver_google_ads_geo
Dims extras: `geo_id`, `region_type` (CITY/STATE/COUNTRY/POSTAL_CODE/COUNTY/DMA_REGION), `city`, `state`, `country`
Métricas: clicks, impressions, video_views (sem quartis)

---

## Kwai (`cost_brl` BRL)

> Único com `agency` + `file_name` — ETL baseado em upload de arquivo.

### silver_kwai_daily
Grain: ad-level diário
Métricas: impressions, clicks, video_plays_3s, video_plays_5s, video_completions, **thruplays**, engagements

### silver_kwai_audience
Dims extras: `age`, `gender`
Métricas: mesmas que daily

### silver_kwai_geographic
Dims extras: `country`, `subregion_state`
Métricas: mesmas que daily

---

## LinkedIn (`spend` + `spend_in_usd`)

> [!info] Use `spend_in_usd` para comparações em USD com outras plataformas

### silver_linkedin_ads_campaign
Dims extras: `ad_id`
Métricas: impressions, clicks, video_views, video_completions, conversions, **leads**

---

## Pinterest (`spend_in_dollar` USD)

> [!info] Split pago/orgânico em colunas (não em linhas)
> `clicks` vs `organic_clicks` — ambos na mesma linha

### silver_pinterest_campaign
Dims extras: `ad_id`, `pin_id`
Métricas pagas: clicks, impressions, engagements, video_p0/p25/p50/p75/p95/p100
Métricas orgânicas: organic_clicks, organic_impressions, organic_engagements, organic_video_p0/p25/p50/p75/p95/p100

---

## TikTok (`spend` BRL)

### silver_tiktok_ads_campaigns (~50 colunas)
Dims extras: `ad_id`
Métricas: impressions, clicks, video_views, video_watched_2s, video_watched_6s, video_p25/p50/p75/p100, engaged_view_15s, **follows**, **music_clicks**, conversions, paid_conversions, **vta_conversions**, **cta_conversions**, **leads**

### silver_tiktok_audience
Dims extras: `age` (AGE_13_17/AGE_18_24/AGE_25_34/AGE_35_44/AGE_45_54/AGE_55_100), `gender` (MALE/FEMALE/OTHER)
Métricas: impressions, clicks, result, conversion

### silver_tiktok_regions
Dims extras: `province_id`, `region_name`
Métricas: impressions, clicks, result, conversion

---

Ver também: [[Gold Layer]] · [[Schema SQL]]
