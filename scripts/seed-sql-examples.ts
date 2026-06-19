/**
 * seed-sql-examples.ts — populate the RAG example library (sql_examples).
 *
 * Embeds each question with nomic-embed-text via Ollama and upserts by
 * question text (idempotent — re-run after editing the EXAMPLES array;
 * this script is the maintenance path for the library).
 *
 * Run:  bun --env-file=.env.local scripts/seed-sql-examples.ts
 *       (or npm run db:seed-examples)
 * Embedding: Google gemini-embedding-001 via GOOGLE_GENERATIVE_AI_API_KEY
 * (must match lib/rag.ts EMBED_MODEL — query and library vectors must come
 * from the same model).
 */
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { embed as aiEmbed } from 'ai'
import { sqlExamples } from '../lib/db/schema'
import { isNeonHost, pgEnv } from '../lib/db/env'

const EMBED_MODEL = process.env.EMBED_MODEL ?? 'gemini-embedding-001'

const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })

type Example = { question: string; sql: string; dims: string[] }

const DATE_FLOOR = `date >= '2026-04-01'`
const VOLUME = `HAVING COUNT(DISTINCT ad_name) >= 3 AND SUM(impressions) >= 10000`

const EXAMPLES: Example[] = [
  // ── Eixo × Visual ──
  {
    question: 'Para o tema Saúde, qual elemento visual performa melhor: beneficiário ou dados?',
    dims: ['eixo', 'visual'],
    sql: `SELECT visual, COUNT(DISTINCT ad_name) AS pecas, SUM(impressions) AS impressoes,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(cost)/NULLIF(SUM(video_views),0) AS cpv
FROM gold_campaigns_classified
WHERE eixo = 'SAU' AND formato = 'VIDEO' AND visual IS NOT NULL AND ${DATE_FLOOR}
GROUP BY visual ${VOLUME} ORDER BY vtr DESC;`,
  },
  {
    question: 'Qual linguagem visual funciona melhor nos vídeos de Economia?',
    dims: ['eixo', 'visual'],
    sql: `SELECT visual, COUNT(DISTINCT ad_name) AS pecas,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_campaigns_classified
WHERE eixo = 'ECO' AND formato = 'VIDEO' AND visual IS NOT NULL AND ${DATE_FLOOR}
GROUP BY visual ${VOLUME} ORDER BY vtr DESC;`,
  },
  // ── Eixo × Tom ──
  {
    question: 'Para Economia, o público responde melhor a tom emocional ou a dados/evidência?',
    dims: ['eixo', 'tom'],
    sql: `SELECT tom, COUNT(DISTINCT ad_name) AS pecas,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr,
       SUM(cost)/NULLIF(SUM(engagements),0) AS cpe
FROM gold_campaigns_classified
WHERE eixo = 'ECO' AND formato = 'VIDEO' AND tom IS NOT NULL AND ${DATE_FLOOR}
GROUP BY tom HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY ctr DESC;`,
  },
  {
    question: 'Qual tom de mensagem tem melhor engajamento nos conteúdos de Trabalho?',
    dims: ['eixo', 'tom'],
    sql: `SELECT tom, COUNT(DISTINCT ad_name) AS pecas,
       SUM(engagements)/NULLIF(SUM(impressions),0)*100 AS taxa_engaj,
       SUM(cost)/NULLIF(SUM(engagements),0) AS cpe
FROM gold_campaigns_classified
WHERE eixo = 'TRB' AND formato = 'VIDEO' AND tom IS NOT NULL AND ${DATE_FLOOR}
GROUP BY tom HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY taxa_engaj DESC;`,
  },
  // ── Programa × Porta-voz ──
  {
    question: 'Influenciador gera mais resultado para o Pé de Meia que narração em off?',
    dims: ['programa', 'porta_voz'],
    sql: `SELECT porta_voz, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(cost)/NULLIF(SUM(video_views),0) AS cpv
FROM gold_campaigns_classified
WHERE programa = 'PDM' AND formato = 'VIDEO' AND porta_voz IS NOT NULL AND ${DATE_FLOOR}
GROUP BY porta_voz HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY vtr DESC;`,
  },
  {
    question: 'Qual porta-voz funciona melhor nos vídeos da Escala 6x1?',
    dims: ['programa', 'porta_voz'],
    sql: `SELECT porta_voz, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr
FROM gold_campaigns_classified
WHERE programa = 'E61' AND formato = 'VIDEO' AND porta_voz IS NOT NULL AND ${DATE_FLOOR}
GROUP BY porta_voz HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY vtr DESC;`,
  },
  // ── Programa × Visual ──
  {
    question: 'Para o Bolsa Família, meme performa melhor que infográfico?',
    dims: ['programa', 'visual'],
    sql: `SELECT visual, COUNT(DISTINCT ad_name) AS pecas,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr,
       SUM(cost)/NULLIF(SUM(impressions),0)*1000 AS cpm
FROM gold_campaigns_classified
WHERE programa = 'BF' AND formato = 'VIDEO' AND visual IS NOT NULL AND ${DATE_FLOOR}
GROUP BY visual HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY ctr DESC;`,
  },
  // ── Segundagem ──
  {
    question: 'Memes funcionam melhor em vídeos de 15 ou 30 segundos?',
    dims: ['segundagem', 'visual'],
    sql: `SELECT segundagem, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(video_p100)/NULLIF(SUM(impressions),0)*100 AS vtrc
FROM gold_campaigns_classified
WHERE visual = 'MEM' AND formato = 'VIDEO' AND segundagem IS NOT NULL AND ${DATE_FLOOR}
GROUP BY segundagem HAVING COUNT(DISTINCT ad_name) >= 3
ORDER BY FIELD(segundagem,'6S','15S','30S','60S','90S','L');`,
  },
  {
    question: 'Qual duração de vídeo tem melhor taxa de conclusão por tema?',
    dims: ['eixo', 'segundagem'],
    sql: `SELECT eixo, segundagem, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_p100)/NULLIF(SUM(impressions),0)*100 AS vtrc
FROM gold_campaigns_classified
WHERE formato = 'VIDEO' AND eixo IS NOT NULL AND segundagem IS NOT NULL AND ${DATE_FLOOR}
GROUP BY eixo, segundagem HAVING COUNT(DISTINCT ad_name) >= 3
ORDER BY eixo, FIELD(segundagem,'6S','15S','30S','60S','90S','L');`,
  },
  {
    question: 'Temas complexos como Infraestrutura precisam de vídeos mais longos?',
    dims: ['eixo', 'segundagem'],
    sql: `SELECT segundagem, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(video_p100)/NULLIF(SUM(impressions),0)*100 AS vtrc
FROM gold_campaigns_classified
WHERE eixo = 'INFRA' AND formato = 'VIDEO' AND segundagem IS NOT NULL AND ${DATE_FLOOR}
GROUP BY segundagem HAVING COUNT(DISTINCT ad_name) >= 3
ORDER BY FIELD(segundagem,'6S','15S','30S','60S','90S','L');`,
  },
  // ── Formato × Tom ──
  {
    question: 'Carrossel funciona melhor com tom informativo ou emocional?',
    dims: ['formato', 'tom'],
    sql: `SELECT tom, COUNT(DISTINCT ad_name) AS pecas,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr,
       SUM(cost)/NULLIF(SUM(engagements),0) AS cpe
FROM gold_campaigns_classified
WHERE formato = 'CARROSSEL' AND tom IS NOT NULL AND ${DATE_FLOOR}
GROUP BY tom HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY ctr DESC;`,
  },
  // ── Tom × Visual ──
  {
    question: 'Tom de urgência combina melhor com dados ou com ilustração?',
    dims: ['tom', 'visual'],
    sql: `SELECT visual, COUNT(DISTINCT ad_name) AS pecas,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr
FROM gold_campaigns_classified
WHERE tom = 'URG' AND formato = 'VIDEO' AND visual IS NOT NULL AND ${DATE_FLOOR}
GROUP BY visual HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY ctr DESC;`,
  },
  // ── Conteúdo × Mídia ──
  {
    question: 'Meme performa melhor em qual plataforma?',
    dims: ['visual', 'platform'],
    sql: `SELECT platform, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(cost)/NULLIF(SUM(impressions),0)*1000 AS cpm
FROM gold_campaigns_classified
WHERE visual = 'MEM' AND formato = 'VIDEO' AND ${DATE_FLOOR}
GROUP BY platform HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY vtr DESC;`,
  },
  {
    question: 'Tom emocional funciona melhor com qual faixa etária de público-alvo?',
    dims: ['tom', 'target_age'],
    sql: `SELECT target_age, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_campaigns_classified
WHERE tom = 'EMO' AND formato = 'VIDEO' AND target_age IS NOT NULL AND ${DATE_FLOOR}
GROUP BY target_age HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY vtr DESC;`,
  },
  {
    question: 'O Bolsa Família engaja mais em qual segmentação geográfica?',
    dims: ['programa', 'target_geo'],
    sql: `SELECT target_geo, COUNT(DISTINCT ad_name) AS pecas,
       SUM(engagements)/NULLIF(SUM(impressions),0)*100 AS taxa_engaj
FROM gold_campaigns_classified
WHERE programa = 'BF' AND target_geo IS NOT NULL AND ${DATE_FLOOR}
GROUP BY target_geo HAVING SUM(impressions) >= 10000 ORDER BY taxa_engaj DESC;`,
  },
  {
    question: 'Influenciador funciona melhor como dark post ou impulsionado?',
    dims: ['porta_voz', 'dark_feed'],
    sql: `SELECT porta_voz, dark_feed, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(cost)/NULLIF(SUM(engagements),0) AS cpe
FROM gold_campaigns_classified
WHERE porta_voz IN ('INFLU','OFF') AND dark_feed IS NOT NULL AND formato = 'VIDEO' AND ${DATE_FLOOR}
GROUP BY porta_voz, dark_feed HAVING COUNT(DISTINCT ad_name) >= 3;`,
  },
  {
    question: 'Vídeos para o público feminino performam melhor com qual tom?',
    dims: ['tom', 'target_gender'],
    sql: `SELECT tom, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(engagements)/NULLIF(SUM(impressions),0)*100 AS taxa_engaj
FROM gold_campaigns_classified
WHERE target_gender = 'M' AND formato = 'VIDEO' AND tom IS NOT NULL AND ${DATE_FLOOR}
GROUP BY tom HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY vtr DESC;`,
  },
  // ── Código gerado / outliers ──
  {
    question: 'Quais os 10 melhores códigos criativos por CTR?',
    dims: ['creative_code'],
    sql: `SELECT creative_code, COUNT(DISTINCT ad_name) AS pecas, SUM(cost) AS investimento,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr
FROM gold_campaigns_classified
WHERE creative_code IS NOT NULL AND classification_source = 'code' AND ${DATE_FLOOR}
GROUP BY creative_code HAVING SUM(cost) >= 1000 ORDER BY ctr DESC LIMIT 10;`,
  },
  {
    question: 'Quais combinações criativas estão performando abaixo da média e deveriam ser descontinuadas?',
    dims: ['creative_code'],
    sql: `SELECT creative_code, COUNT(DISTINCT ad_name) AS pecas, SUM(cost) AS investimento,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_campaigns_classified
WHERE creative_code IS NOT NULL AND classification_source = 'code' AND ${DATE_FLOOR}
GROUP BY creative_code HAVING SUM(cost) >= 1000 ORDER BY ctr ASC LIMIT 10;`,
  },
  {
    question: 'Há sinais de fadiga criativa na combinação meme + celebração?',
    dims: ['visual', 'tom', 'temporal'],
    sql: `SELECT YEARWEEK(date, 3) AS semana, SUM(impressions) AS impressoes,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_campaigns_classified
WHERE visual = 'MEM' AND tom = 'CEL' AND formato = 'VIDEO' AND ${DATE_FLOOR}
GROUP BY YEARWEEK(date, 3) ORDER BY semana;`,
  },
  // ── Enquadramento ──
  {
    question: 'O enquadramento econômico da Escala 6x1 performa diferente do enquadramento trabalhista?',
    dims: ['programa', 'eixo'],
    sql: `SELECT eixo, COUNT(DISTINCT ad_name) AS pecas,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr,
       SUM(cost)/NULLIF(SUM(engagements),0) AS cpe
FROM gold_campaigns_classified
WHERE programa = 'E61' AND formato = 'VIDEO' AND eixo IS NOT NULL AND ${DATE_FLOOR}
GROUP BY eixo HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY ctr DESC;`,
  },
  // ── Terceira ordem ──
  {
    question: 'Qual a combinação ideal de visual e tom para a Escala 6x1?',
    dims: ['programa', 'visual', 'tom'],
    sql: `SELECT visual, tom, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(cost)/NULLIF(SUM(video_views),0) AS cpv
FROM gold_campaigns_classified
WHERE programa = 'E61' AND formato = 'VIDEO' AND visual IS NOT NULL AND tom IS NOT NULL AND ${DATE_FLOOR}
GROUP BY visual, tom ${VOLUME} ORDER BY vtr DESC;`,
  },
  {
    question: 'Qual duração e linguagem visual ideais para vídeos de Saúde?',
    dims: ['eixo', 'segundagem', 'visual'],
    sql: `SELECT segundagem, visual, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_p100)/NULLIF(SUM(impressions),0)*100 AS vtrc
FROM gold_campaigns_classified
WHERE eixo = 'SAU' AND formato = 'VIDEO' AND segundagem IS NOT NULL AND visual IS NOT NULL AND ${DATE_FLOOR}
GROUP BY segundagem, visual HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY vtrc DESC;`,
  },
  // ── Pessoas / influenciadores ──
  {
    question: 'Qual influenciador teve melhor performance nos vídeos?',
    dims: ['person_name'],
    sql: `SELECT person_name, COUNT(DISTINCT ad_name) AS pecas, SUM(impressions) AS impressoes,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(cost)/NULLIF(SUM(video_views),0) AS cpv
FROM gold_campaigns_classified
WHERE person_name IS NOT NULL AND formato = 'VIDEO'
GROUP BY person_name HAVING SUM(impressions) >= 10000 ORDER BY vtr DESC LIMIT 15;`,
  },
  {
    question: 'Compare a performance dos criadores de conteúdo no Pé de Meia',
    dims: ['person_name', 'programa'],
    sql: `SELECT person_name, COUNT(DISTINCT ad_name) AS pecas,
       SUM(impressions) AS impressoes,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_campaigns_classified
WHERE person_name IS NOT NULL AND programa = 'PDM'
GROUP BY person_name ORDER BY vtr DESC;`,
  },
  // ── Cobertura / auditoria ──
  {
    question: 'Qual a cobertura da classificação criativa por mês?',
    dims: ['auditoria'],
    sql: `SELECT DATE_FORMAT(date,'%Y-%m') AS mes,
       ROUND(100*SUM(CASE WHEN classification_source='code' THEN cost ELSE 0 END)/NULLIF(SUM(cost),0),1) AS pct_custo_codigo,
       ROUND(100*SUM(CASE WHEN eixo IS NOT NULL THEN cost ELSE 0 END)/NULLIF(SUM(cost),0),1) AS pct_custo_classificado
FROM gold_campaigns_classified
GROUP BY DATE_FORMAT(date,'%Y-%m') ORDER BY mes;`,
  },
  // ── Comparativos por eixo/programa (visões macro) ──
  {
    question: 'Qual eixo temático teve melhor performance este mês?',
    dims: ['eixo'],
    sql: `SELECT eixo_label AS tema, COUNT(DISTINCT ad_name) AS pecas, SUM(cost) AS investimento,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_campaigns_classified
WHERE eixo IS NOT NULL AND formato = 'VIDEO'
  AND date BETWEEN DATE_FORMAT(CURDATE(),'%Y-%m-01') AND CURDATE()
GROUP BY eixo_label HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY vtr DESC;`,
  },
  {
    question: 'Compare o investimento e o desempenho entre os programas de governo nos últimos 30 dias',
    dims: ['programa'],
    sql: `SELECT programa_label AS programa_nome, COUNT(DISTINCT ad_name) AS pecas,
       SUM(cost) AS investimento, SUM(impressions) AS impressoes,
       SUM(clicks)/NULLIF(SUM(impressions),0)*100 AS ctr
FROM gold_campaigns_classified
WHERE programa IS NOT NULL AND date BETWEEN DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND CURDATE()
GROUP BY programa_label ORDER BY investimento DESC;`,
  },
  {
    question: 'Qual foi o investimento e o alcance da Escala 6x1 na Meta?',
    dims: ['programa'],
    sql: `SELECT programa_label AS programa, COUNT(DISTINCT ad_name) AS pecas,
       SUM(cost) AS investimento, SUM(impressions) AS impressoes, SUM(reach) AS alcance
FROM gold_campaigns_classified
WHERE programa_label = 'Escala 6×1' AND platform = 'meta'
GROUP BY programa_label;`,
  },
  {
    question: 'Como a campanha do Bolsa Família vem performando ao longo dos meses?',
    dims: ['programa'],
    sql: `SELECT DATE_FORMAT(date,'%Y-%m') AS mes, COUNT(DISTINCT ad_name) AS pecas,
       SUM(cost) AS investimento, SUM(impressions) AS impressoes,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_campaigns_classified
WHERE programa_label = 'Bolsa Família'
GROUP BY DATE_FORMAT(date,'%Y-%m') ORDER BY mes;`,
  },
  {
    question: 'Qual formato de peça tem o menor custo por engajamento?',
    dims: ['formato'],
    sql: `SELECT formato, COUNT(DISTINCT ad_name) AS pecas,
       SUM(cost)/NULLIF(SUM(engagements),0) AS cpe,
       SUM(cost)/NULLIF(SUM(impressions),0)*1000 AS cpm
FROM gold_campaigns_classified
WHERE formato IS NOT NULL AND ${DATE_FLOOR}
GROUP BY formato HAVING COUNT(DISTINCT ad_name) >= 3 ORDER BY cpe ASC;`,
  },
  // ── Clássicos (não-framework, mantêm o RAG útil para perguntas gerais) ──
  {
    question: 'Como está a performance da campanha X por plataforma este mês?',
    dims: ['performance'],
    sql: `SELECT platform, SUM(impressions) AS impressoes, SUM(video_views) AS views,
       SUM(cost)/NULLIF(SUM(video_views),0) AS cpv,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(cost)/NULLIF(SUM(impressions),0)*1000 AS cpm
FROM gold_platforms_campaigns
WHERE campaign_name LIKE '%X%' AND date BETWEEN DATE_FORMAT(CURDATE(),'%Y-%m-01') AND CURDATE()
GROUP BY platform;`,
  },
  {
    question: 'Quais os 5 melhores criativos por visualizações na campanha X?',
    dims: ['criativos'],
    sql: `SELECT ad_name, SUM(impressions) AS impressoes, SUM(video_views) AS views,
       SUM(cost)/NULLIF(SUM(video_views),0) AS cpv,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_platforms_campaigns
WHERE campaign_name LIKE '%X%'
GROUP BY ad_name ORDER BY views DESC LIMIT 5;`,
  },
  {
    question: 'Mostre a evolução diária de investimento e impressões da campanha X',
    dims: ['temporal'],
    sql: `SELECT date, SUM(impressions) AS impressoes, SUM(video_views) AS views, SUM(cost) AS investimento
FROM gold_platforms_campaigns
WHERE campaign_name LIKE '%X%'
GROUP BY date ORDER BY date;`,
  },
  {
    question: 'Qual o breakdown por região da campanha X?',
    dims: ['geo'],
    sql: `SELECT region_name, SUM(impressions) AS impressoes, SUM(clicks) AS cliques, SUM(reach) AS alcance
FROM gold_platforms_regions
WHERE campaign_name LIKE '%X%'
GROUP BY region_name ORDER BY impressoes DESC LIMIT 20;`,
  },
  {
    question: 'Qual faixa etária assiste mais os vídeos da campanha X no Meta?',
    dims: ['demografia'],
    sql: `SELECT age, SUM(impressions) AS impressoes, SUM(video_views) AS views,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_platforms_age
WHERE platform = 'meta' AND campaign_name LIKE '%X%'
GROUP BY age ORDER BY impressoes DESC;`,
  },
  {
    question: 'Qual o CPV e VTR no Kwai e LinkedIn usando video completions?',
    dims: ['video'],
    sql: `SELECT platform, SUM(impressions) AS impressoes, SUM(video_completions) AS thruplays,
       SUM(cost)/NULLIF(SUM(video_completions),0) AS cpv,
       SUM(video_completions)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_platforms_campaigns
WHERE platform IN ('kwai','linkedin')
GROUP BY platform;`,
  },
  {
    question: 'Quais campanhas estão ativas atualmente?',
    dims: ['descoberta'],
    sql: `SELECT DISTINCT campaign_name, platform, MIN(date) AS inicio, MAX(date) AS fim
FROM gold_platforms_campaigns
GROUP BY campaign_name, platform
HAVING MAX(date) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
ORDER BY fim DESC LIMIT 30;`,
  },
  {
    question: 'Vídeos com apresentador retêm mais audiência que vídeos com ator?',
    dims: ['visual', 'porta_voz'],
    sql: `SELECT porta_voz, COUNT(DISTINCT ad_name) AS pecas,
       SUM(video_p100)/NULLIF(SUM(impressions),0)*100 AS vtrc,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_campaigns_classified
WHERE porta_voz IN ('APR','ATO') AND formato = 'VIDEO' AND ${DATE_FLOOR}
GROUP BY porta_voz HAVING COUNT(DISTINCT ad_name) >= 3;`,
  },

  // ── gold_regions_classified ──
  {
    question: 'Qual campanha melhor performou por tema no Rio de Janeiro no mês passado?',
    dims: ['eixo', 'regiao'],
    sql: `SELECT eixo, campaign_name, SUM(cost) AS investimento, SUM(impressions) AS impressoes,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_regions_classified
WHERE region_name LIKE '%Rio de Janeiro%'
  AND date BETWEEN DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
                AND LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
  AND eixo IS NOT NULL
GROUP BY eixo, campaign_name
ORDER BY investimento DESC LIMIT 20;`,
  },
  {
    question: 'Qual tema (eixo) teve melhor VTR no Nordeste?',
    dims: ['eixo', 'regiao'],
    sql: `SELECT eixo, SUM(impressions) AS impressoes,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(cost) AS investimento
FROM gold_regions_classified
WHERE region_name IN ('Maranhão','Piauí','Ceará','Rio Grande do Norte','Paraíba',
                      'Pernambuco','Alagoas','Sergipe','Bahia')
  AND eixo IS NOT NULL AND ${DATE_FLOOR}
GROUP BY eixo
HAVING SUM(impressions) >= 10000
ORDER BY vtr DESC;`,
  },
  {
    question: 'Comparar investimento por tema entre São Paulo e Rio de Janeiro',
    dims: ['eixo', 'regiao'],
    sql: `SELECT eixo,
       SUM(CASE WHEN region_name LIKE '%São Paulo%' THEN cost ELSE 0 END) AS custo_sp,
       SUM(CASE WHEN region_name LIKE '%Rio de Janeiro%' THEN cost ELSE 0 END) AS custo_rj,
       SUM(cost) AS total
FROM gold_regions_classified
WHERE region_name IN ('São Paulo','Rio de Janeiro')
  AND eixo IS NOT NULL AND ${DATE_FLOOR}
GROUP BY eixo ORDER BY total DESC;`,
  },

  // ── gold_age_gender_classified ──
  {
    question: 'Qual tema ressoa mais com mulheres de 25 a 34 anos?',
    dims: ['eixo', 'demografia'],
    sql: `SELECT eixo, SUM(impressions) AS impressoes,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr,
       SUM(cost) AS investimento
FROM gold_age_gender_classified
WHERE gender IN ('female','Female','FEMALE')
  AND age IN ('25-34','25 a 34','AGE_RANGE_25_34','AGE_25_34')
  AND eixo IS NOT NULL AND ${DATE_FLOOR}
GROUP BY eixo
HAVING SUM(impressions) >= 10000
ORDER BY vtr DESC;`,
  },
  {
    question: 'Qual faixa etária engaja mais com o tema Economia?',
    dims: ['eixo', 'demografia'],
    sql: `SELECT platform, age, SUM(impressions) AS impressoes,
       SUM(engagements)/NULLIF(SUM(impressions),0)*100 AS taxa_engaj,
       SUM(cost) AS investimento
FROM gold_age_gender_classified
WHERE eixo = 'ECO' AND age IS NOT NULL AND ${DATE_FLOOR}
GROUP BY platform, age
HAVING SUM(impressions) >= 10000
ORDER BY taxa_engaj DESC;`,
  },
  {
    question: 'Comparar VTR por gênero para cada tema criativo',
    dims: ['eixo', 'demografia'],
    sql: `SELECT eixo, gender,
       SUM(impressions) AS impressoes,
       SUM(video_views)/NULLIF(SUM(impressions),0)*100 AS vtr
FROM gold_age_gender_classified
WHERE eixo IS NOT NULL AND gender IS NOT NULL
  AND gender NOT IN ('unknown','Unknown','UNDETERMINED','NONE')
  AND ${DATE_FLOOR}
GROUP BY eixo, gender
HAVING SUM(impressions) >= 10000
ORDER BY eixo, vtr DESC;`,
  },
]

async function main() {
  const client = postgres({
    host:     pgEnv.host,
    port:     pgEnv.port,
    database: pgEnv.database,
    username: pgEnv.user,
    password: pgEnv.password,
    ssl:      isNeonHost ? 'require' : false,
    max:      1,
  })
  const db = drizzle(client)

  console.log(`Embedding ${EXAMPLES.length} examples with ${EMBED_MODEL}...`)
  let ok = 0
  for (const ex of EXAMPLES) {
    const res = await aiEmbed({ model: google.textEmbedding(EMBED_MODEL), value: ex.question })
    const embedding = res.embedding
    if (!embedding?.length) throw new Error(`empty embedding for: ${ex.question}`)

    await db
      .insert(sqlExamples)
      .values({ question: ex.question, sql: ex.sql, dims: ex.dims, embedding, enabled: true })
      .onConflictDoUpdate({
        target: sqlExamples.question,
        set: { sql: ex.sql, dims: ex.dims, embedding, enabled: true, updatedAt: new Date() },
      })
    ok++
    process.stdout.write(`\r  ${ok}/${EXAMPLES.length}`)
  }
  console.log(`\nDone — ${ok} examples upserted.`)
  await client.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
