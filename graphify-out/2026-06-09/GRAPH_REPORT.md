# Graph Report - .  (2026-06-08)

## Corpus Check
- Corpus is ~48,094 words - fits in a single context window. You may not need a graph.

## Summary
- 906 nodes · 1309 edges · 56 communities (45 shown, 11 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 95 edges (avg confidence: 0.82)
- Token cost: 22,600 input · 6,300 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Admin UI & Pages|Admin UI & Pages]]
- [[_COMMUNITY_API Routes & SQL Engine|API Routes & SQL Engine]]
- [[_COMMUNITY_Campaign Reports & Agencies|Campaign Reports & Agencies]]
- [[_COMMUNITY_OpenAPI Specification|OpenAPI Specification]]
- [[_COMMUNITY_Chart SVG Rendering|Chart SVG Rendering]]
- [[_COMMUNITY_User Data Model|User Data Model]]
- [[_COMMUNITY_AI Chat & KPI Framework|AI Chat & KPI Framework]]
- [[_COMMUNITY_DB Schema Relations|DB Schema Relations]]
- [[_COMMUNITY_Authentication Flow|Authentication Flow]]
- [[_COMMUNITY_Frontend Dependencies|Frontend Dependencies]]
- [[_COMMUNITY_Home & Navigation UI|Home & Navigation UI]]
- [[_COMMUNITY_DB Schema Columns|DB Schema Columns]]
- [[_COMMUNITY_AI SDK Dependencies|AI SDK Dependencies]]
- [[_COMMUNITY_Verification Engine Core|Verification Engine Core]]
- [[_COMMUNITY_DB Migration Schema|DB Migration Schema]]
- [[_COMMUNITY_Adforce Parser|Adforce Parser]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_DB Schema Constraints|DB Schema Constraints]]
- [[_COMMUNITY_Users Admin Table|Users Admin Table]]
- [[_COMMUNITY_Ahead Parser|Ahead Parser]]
- [[_COMMUNITY_Verification HTTP Server|Verification HTTP Server]]
- [[_COMMUNITY_00px Ad Parser|00px Ad Parser]]
- [[_COMMUNITY_Admotion Parser|Admotion Parser]]
- [[_COMMUNITY_Category Mapping|Category Mapping]]
- [[_COMMUNITY_Metrike Parser|Metrike Parser]]
- [[_COMMUNITY_Chat Data Schema|Chat Data Schema]]
- [[_COMMUNITY_File Upload Schema|File Upload Schema]]
- [[_COMMUNITY_Session Schema|Session Schema]]
- [[_COMMUNITY_Comprovante Parser|Comprovante Parser]]
- [[_COMMUNITY_User Role Schema|User Role Schema]]
- [[_COMMUNITY_Chat Session Schema|Chat Session Schema]]
- [[_COMMUNITY_DB Timestamps|DB Timestamps]]
- [[_COMMUNITY_DB Primary Keys|DB Primary Keys]]
- [[_COMMUNITY_User Activity Tracking|User Activity Tracking]]
- [[_COMMUNITY_Next.js Configuration|Next.js Configuration]]
- [[_COMMUNITY_Parser Utilities|Parser Utilities]]
- [[_COMMUNITY_File Bytes Schema|File Bytes Schema]]
- [[_COMMUNITY_Chat Message Schema|Chat Message Schema]]
- [[_COMMUNITY_Filename Schema|Filename Schema]]
- [[_COMMUNITY_File Size Schema|File Size Schema]]
- [[_COMMUNITY_URL Info Writer|URL Info Writer]]
- [[_COMMUNITY_DB Tunnel Scripts|DB Tunnel Scripts]]
- [[_COMMUNITY_Migration Journal|Migration Journal]]
- [[_COMMUNITY_BRZ Parser|BRZ Parser]]
- [[_COMMUNITY_Apple Touch Icon|Apple Touch Icon]]
- [[_COMMUNITY_App Icon|App Icon]]
- [[_COMMUNITY_Root Layout|Root Layout]]
- [[_COMMUNITY_Deploy Scripts|Deploy Scripts]]
- [[_COMMUNITY_Waiting Page|Waiting Page]]
- [[_COMMUNITY_PostCSS Config|PostCSS Config]]
- [[_COMMUNITY_Excel Library|Excel Library]]
- [[_COMMUNITY_Fuzzy Match Library|Fuzzy Match Library]]
- [[_COMMUNITY_Vercel Headers Config|Vercel Headers Config]]
- [[_COMMUNITY_Creative Format Motion|Creative Format: Motion]]

## God Nodes (most connected - your core abstractions)
1. `requireAuth()` - 22 edges
2. `getSession` - 18 edges
3. `db` - 16 edges
4. `compilerOptions` - 16 edges
5. `parse_date()` - 15 edges
6. `col_index()` - 15 edges
7. `to_int()` - 13 edges
8. `Status Diário Nov 5 2026 - Posicionamento SP (Novo Posicionamento Estadual SP / CALIA)` - 12 edges
9. `normaliza_categoria()` - 11 edges
10. `parse_comprovante()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Relatório Detalhado — Campanha Combustíveis Abril 2026 (Data Table)` --semantically_similar_to--> `gold_platforms_campaigns — Main Analytics Fact Table (MySQL)`  [INFERRED] [semantically similar]
  modelos_pdf/Relat_rio Detalhado - Campanha Combust_veis _Abril 2026_.pdf → performance_rules.md
- `Framework Analítico — Performance de Conteúdos do Governo Federal` --semantically_similar_to--> `performance_rules.md — Official SECOM KPI Benchmarks by Platform`  [INFERRED] [semantically similar]
  Framework Performance Analysis v4.md → performance_rules.md
- `index.html — Standalone n8n Webhook Chat UI (visionOS Design)` --semantically_similar_to--> `Next.js 16 App Router — Jarvis SECOM Frontend`  [INFERRED] [semantically similar]
  index.html → README.md
- `Status Geral TPB CALIA — Campaign Report Amazonas & Santa Catarina (Apr 2026)` --implements--> `Weekly Status Report Format — Números Gerais + Por Plataforma + Destaque da Semana`  [EXTRACTED]
  paper-exemples/STATUS GERAL - TPB CALIA - 10.04.26.txt → modelos_pdf/Status Diário Apr 26 Combustíveis.pdf
- `Meta Ads Visualizações KPIs — ThruPlay, CPV, TPR, VTRc (PDF benchmarks)` --conceptually_related_to--> `SECOM Official Performance Benchmarks (CPV, VTR, CTR, CPM by Platform)`  [EXTRACTED]
  KPIs Performance Indicators Sept 25.pdf → performance_rules.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **SECOM KPI Benchmark Ecosystem — Rules, PDF Source, and Live Reports** — jarvis_ui_performance_rules, jarvis_ui_kpis_pdf, jarvis_ui_secom_benchmarks, jarvis_ui_weekly_status_report_format [EXTRACTED 0.95]
- **Creative Performance Analysis Framework — Dimensions, Codes, and Cross-Analysis** — jarvis_ui_framework_performance_analysis_v4, jarvis_ui_content_classification_7dimensions, jarvis_ui_creative_code_system, jarvis_ui_cross_dimension_analysis [EXTRACTED 0.95]
- **Secure AI Chat Pipeline — NL Input → SQL Guard → MySQL → Chart Output** — jarvis_ui_ai_chat_pipeline, jarvis_ui_sql_guard, jarvis_ui_chart_sentinel, jarvis_ui_gold_platforms_campaigns [INFERRED 0.95]
- **TPB Campaign Multi-Agency Reporting (CALIA, NOVA, PROPEG, NACIONAL producing parallel state-level status reports)** — concept_campanha_trabalho_pelo_brasil, concept_agencia_calia, concept_agencia_nova, concept_agencia_propeg, concept_agencia_nacional, concept_nucleo_bi_secom, concept_report_estrutura [EXTRACTED 1.00]
- **Platform KPI Benchmarking Framework (VTR + CPV + SECOM benchmarks applied across all platforms)** — concept_kpi_vtr, concept_kpi_cpv, concept_secom_benchmark, concept_plataforma_meta, concept_plataforma_youtube, concept_plataforma_kwai [INFERRED 0.95]
- **Always On Multi-Platform Influencer Campaign (AON spanning Meta, YouTube, Kwai, TikTok, Twitch, LinkedIn, Streamings)** — concept_campanha_always_on, concept_influenciadores, concept_plataforma_meta, concept_plataforma_youtube, concept_plataforma_kwai, concept_plataforma_tiktok, concept_plataforma_twitch, concept_plataforma_streamings [EXTRACTED 1.00]

## Communities (56 total, 11 thin omitted)

### Community 0 - "Admin UI & Pages"
Cohesion: 0.06
Nodes (50): AdminLayout(), AdminPage(), metadata, PATCH(), GET(), PATCH(), GET(), schema (+42 more)

### Community 1 - "API Routes & SQL Engine"
Cohesion: 0.05
Nodes (40): CHART_SPEC_SCHEMA, CreateDownloadCtx, createDownloadFile(), executeSql(), google, ollamaClient, OllamaMessage, POST() (+32 more)

### Community 2 - "Campaign Reports & Agencies"
Cohesion: 0.09
Nodes (47): Agência CALIA, Agência NACIONAL (NM Secom), Agência AG. NOVA, Agência PROPEG, Análise Mídia Digital (relatório de performance de campanha governamental), Campanha Always On (AON) - Governo do Brasil, Campanha Novo Posicionamento Estadual SP - CALIA, Campanha Novo Acordo do Rio Doce / PTR (+39 more)

### Community 3 - "OpenAPI Specification"
Cohesion: 0.05
Nodes (45): content, description, content, description, content, description, content, description (+37 more)

### Community 4 - "Chart SVG Rendering"
Cohesion: 0.09
Nodes (32): CreateDownloadArgs, axes(), CHART_SVG_DIMS, COLORS, esc(), fmt(), innerSize(), legend() (+24 more)

### Community 5 - "User Data Model"
Cohesion: 0.05
Nodes (42): email, enabled, name, password_hash, updated_at, name, notNull, primaryKey (+34 more)

### Community 6 - "AI Chat & KPI Framework"
Cohesion: 0.06
Nodes (41): AI Chat Pipeline (NL → SQL → MySQL → Chart), CHART_REQUEST Sentinel Pattern for Inline Chart Rendering, 7 Dimensões de Classificação de Conteúdo Criativo, Código Gerado de Peça Criativa (EIXO_PROGRAMA_FORMATO_...), Análise Cruzada de Dimensões Criativas e de Mídia, Dual-Database Pattern (PostgreSQL auth + MySQL analytics), Eixo Temático — Dimensão de Classificação (SAU, ECO, TRB, INFRA...), Format-First Analysis Rule — Never Compare Metrics Across Formats (+33 more)

### Community 7 - "DB Schema Relations"
Cohesion: 0.05
Nodes (37): columnsFrom, columnsTo, name, onDelete, onUpdate, tableFrom, tableTo, chat_messages_chat_session_id_chat_sessions_id_fk (+29 more)

### Community 8 - "Authentication Flow"
Cohesion: 0.08
Nodes (22): POST(), POST(), getSession, LoginPage(), metadata, GET(), metadata, RegisterPage() (+14 more)

### Community 9 - "Frontend Dependencies"
Cohesion: 0.06
Nodes (33): devDependencies, @anthropic-ai/claude-code, drizzle-kit, tailwindcss, @tailwindcss/postcss, @types/dom-speech-recognition, @types/node, @types/pdfkit (+25 more)

### Community 10 - "Home & Navigation UI"
Cohesion: 0.06
Nodes (17): Home(), metadata, PALETTE, Particle, MenuCardProps, ADSERVERS, CRITERIO_OPTIONS, ESTADOS_BRASIL (+9 more)

### Community 11 - "DB Schema Columns"
Cohesion: 0.08
Nodes (26): columnsFrom, columnsTo, name, onDelete, onUpdate, tableFrom, tableTo, columnsFrom (+18 more)

### Community 12 - "AI SDK Dependencies"
Cohesion: 0.08
Nodes (25): dependencies, ai, @ai-sdk/google, @ai-sdk/openai-compatible, bcryptjs, dompurify, drizzle-orm, exceljs (+17 more)

### Community 13 - "Verification Engine Core"
Cohesion: 0.13
Nodes (23): date, _add_optional(), _cell_value(), _compare(), _detect_consolidado_cols(), _fmt_num(), _fuzzy_match(), _merge_by_veiculo() (+15 more)

### Community 14 - "DB Migration Schema"
Cohesion: 0.09
Nodes (22): dialect, enums, public.message_role, public.role, id, _meta, columns, schemas (+14 more)

### Community 15 - "Adforce Parser"
Cohesion: 0.13
Nodes (21): date, _extract_duracao(), _find_header(), _find_verif_header(), _get_verif_sheets(), _is_flat_format(), _load_workbook_safe(), parse_comprovante() (+13 more)

### Community 16 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 17 - "DB Schema Constraints"
Cohesion: 0.11
Nodes (18): columnsFrom, columnsTo, name, onDelete, onUpdate, tableFrom, tableTo, chat_sessions_user_id_users_id_fk (+10 more)

### Community 18 - "Users Admin Table"
Cohesion: 0.21
Nodes (9): EditState, UserRow, SessionUser, logout(), createSession(), saveMessage(), updateSessionTitle(), patchJson() (+1 more)

### Community 19 - "Ahead Parser"
Cohesion: 0.17
Nodes (15): date, _normalize_va(), Decimal (0.622) → percentagem (62.2). Mantém se já > 1., _find_comp_header(), _find_verif_header(), _normalize_va(), parse_comprovante(), parse_verif() (+7 more)

### Community 20 - "Verification HTTP Server"
Cohesion: 0.19
Nodes (11): date, BaseHTTPRequestHandler, _download_url(), handler, _parse_date(), _patch_openpyxl_colors(), Vercel Python serverless function for the verification engine.  Receives POST wi, Patch openpyxl's strict string/color validators to silently drop invalid values. (+3 more)

### Community 21 - "00px Ad Parser"
Cohesion: 0.21
Nodes (12): date, _find_header(), _get_comp_sheets(), _normalize_va(), parse_comprovante(), parse_verif(), Parser 00px — comprovante de entrega + verification de URLs.  Comprovante:   Wor, Parseia arquivo de verification 00px (URL + categoria por linha). (+4 more)

### Community 22 - "Admotion Parser"
Cohesion: 0.21
Nodes (12): date, _find_comp_header(), _find_verif_header(), _normalize_va(), parse_comprovante(), parse_verif(), Parser ADMOTION — comprovante de entrega + verification de URLs.  Comprovante (f, Parseia verification ADMOTION (URL Veiculada, Veículos, Impressões Totais). (+4 more)

### Community 23 - "Category Mapping"
Cohesion: 0.17
Nodes (11): date, normaliza_categoria(), Mapeamento centralizado de categorias de indevidas → chaves internas SECOM.  Imp, Mapeia um nome de categoria para a chave interna SECOM.     Retorna None se a ca, _parse_verif_flat(), Parseia o formato flat ADFORCE (Result 1, header na linha 1).     Indevidas = so, _find_header_row(), parse() (+3 more)

### Community 24 - "Metrike Parser"
Cohesion: 0.23
Nodes (12): date, _find_header(), _find_verif_header(), parse_comprovante(), _parse_header_meta(), parse_verif(), Parser METRIKE — comprovante de entrega + verification de URLs.  Comprovante:, Parseia verification METRIKE (Data, Veículo, Categoria, Url).      praca — sigla (+4 more)

### Community 25 - "Chat Data Schema"
Cohesion: 0.18
Nodes (11): name, notNull, primaryKey, type, chart_data, content, name, notNull (+3 more)

### Community 26 - "File Upload Schema"
Cohesion: 0.18
Nodes (11): expires_at, mime_type, name, notNull, primaryKey, type, name, notNull (+3 more)

### Community 27 - "Session Schema"
Cohesion: 0.18
Nodes (11): token, user_id, columns, name, notNull, primaryKey, type, name (+3 more)

### Community 28 - "Comprovante Parser"
Cohesion: 0.25
Nodes (8): date, _find_header(), parse(), Parser genérico para arquivos de comprovante de entrega.  Detectado por: nome de, Varre as primeiras 25 linhas procurando cabeçalho com 'veículo' E     ('impressõ, Parseia um arquivo de comprovante de entrega (primeira aba).      Retorna list[d, Inferência simples de veículo via nome do arquivo.     Prioriza o último segment, vehicle_from_filename()

### Community 29 - "User Role Schema"
Cohesion: 0.29
Nodes (7): role, default, name, notNull, primaryKey, type, typeSchema

### Community 30 - "Chat Session Schema"
Cohesion: 0.29
Nodes (7): title, columns, default, name, notNull, primaryKey, type

### Community 31 - "DB Timestamps"
Cohesion: 0.33
Nodes (6): created_at, default, name, notNull, primaryKey, type

### Community 32 - "DB Primary Keys"
Cohesion: 0.33
Nodes (6): id, default, name, notNull, primaryKey, type

### Community 33 - "User Activity Tracking"
Cohesion: 0.33
Nodes (6): last_seen, default, name, notNull, primaryKey, type

### Community 34 - "Next.js Configuration"
Cohesion: 0.33
Nodes (5): defaultAllowedDevOrigins, envAllowedDevOrigins, maxUploadBodySize, nextConfig, SizeLimit

### Community 35 - "Parser Utilities"
Cohesion: 0.50
Nodes (4): date, cli_date(), parse_date(), Utilitários compartilhados pelos parsers de verification/comprovante.

### Community 36 - "File Bytes Schema"
Cohesion: 0.40
Nodes (5): name, notNull, primaryKey, type, bytes

### Community 37 - "Chat Message Schema"
Cohesion: 0.40
Nodes (5): name, notNull, primaryKey, type, chat_session_id

### Community 38 - "Filename Schema"
Cohesion: 0.40
Nodes (5): filename, name, notNull, primaryKey, type

### Community 39 - "File Size Schema"
Cohesion: 0.40
Nodes (5): size_bytes, name, notNull, primaryKey, type

### Community 40 - "URL Info Writer"
Cohesion: 0.50
Nodes (4): main(), Escreve o levantamento de URLs indevidas (análise IA) na coluna 30 (URL info) do, Write url_info dict {veiculo: text} into COL_URL_INFO of xlsx_path (in-place)., write()

### Community 41 - "DB Tunnel Scripts"
Cohesion: 0.80
Nodes (4): check_status(), close_tunnel(), open_tunnel(), tunnel-pg.sh script

### Community 42 - "Migration Journal"
Cohesion: 0.50
Nodes (3): dialect, entries, version

## Knowledge Gaps
- **377 isolated node(s):** `date`, `metadata`, `metadata`, `metadata`, `UserRow` (+372 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `tables` connect `DB Schema Relations` to `DB Schema Constraints`, `DB Schema Columns`, `User Data Model`, `DB Migration Schema`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `columns` connect `File Upload Schema` to `DB Primary Keys`, `File Bytes Schema`, `Chat Message Schema`, `Filename Schema`, `File Size Schema`, `DB Schema Columns`, `Session Schema`, `DB Timestamps`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `public.file_exports` connect `DB Schema Columns` to `File Upload Schema`, `DB Schema Relations`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `requireAuth()` (e.g. with `GET()` and `PATCH()`) actually correct?**
  _`requireAuth()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `date`, `Vercel Python serverless function for the verification engine.  Receives POST wi`, `Patch openpyxl's strict string/color validators to silently drop invalid values.` to the rest of the system?**
  _441 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Admin UI & Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.05744888023369036 - nodes in this community are weakly interconnected._
- **Should `API Routes & SQL Engine` be split into smaller, more focused modules?**
  _Cohesion score 0.05257936507936508 - nodes in this community are weakly interconnected._