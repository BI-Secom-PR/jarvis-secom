# Sistema de Verificação

Este documento descreve o sistema de verificação de campanhas do JARVIS, que é um componente separado do sistema de chat.

## Visão Geral

A rota de verificação é **isolada** do chat — não compartilha estado, API ou lógica com `/chat`.

### Fluxo de 3 arquivos
1. **Consolidado** — template SECOM 29 colunas (gerado pelas agências via `TEMPLATE - Consolidado Verification.xlsx`)
2. **Comprovante(s)** — relatório de entrega do adserver (um ou mais arquivos `.xlsx`)
3. **Verification URL(s)** — arquivo de verification com categoria+URL por linha (opcional, um ou mais)

## Arquitetura de parsers por adserver
O usuário seleciona o adserver na UI. Cada adserver tem seu próprio módulo em `app/verification/parsers/`:

| Adserver | Módulo | Notas |
|---|---|---|
| 00px | `parser_00px.py` | Multi-sheet CPM+CPC+CPV, VA (IAB) viewability; verif tem layout multi-seção (ver nota abaixo) |
| ADFORCE | `parser_adforce.py` | Sheet única, viewabilidade média ponderada, verif multi-sheet (pula ABAT); tolera células NaN no XML |
| ADMOTION | `parser_admotion.py` | Site (CM360) como veículo, Active View columns, URL Veiculada |
| AHEAD | `parser_ahead.py` | Mesmo formato CM360 do ADMOTION |
| METRIKE | `parser_metrike.py` | Sheet "Worksheet", linha #TOTAL POR CAMPANHA para contratado; viewability = viewables/impressões×100; comprovante tem subtotais por placement — ver nota abaixo |
| SENSE | `parser_sense.py` | Multi-shape por header (não por campanha) — ver seção SENSE abaixo; fixtures em `verification/SENSE/` |
| BRZ | `parser_brz.py` | Placeholder — `NotImplementedError` (adserver em ajuste) |

Cada parser exporta `parse_comprovante(filepath, data_ini, data_fim)` e `parse_verif(filepath, data_ini, data_fim, praca=None)`.
Para adicionar novo adserver: criar `parser_X.py` com as duas funções e adicionar ao `PARSER_MAP` em `engine.py`.

## Subtotais em comprovantes (`parse_comprovante`)
Os comprovantes METRIKE e 00px contêm subtotais cujo label fica na **coluna Data** (não na coluna Veículo): `#TOTAL POR VEÍCULO`, `#TOTAL POR CANAL`, `Total por placement_id`. O guard de `#TOTAL` na coluna Veículo não os captura. Ambos os parsers descartam qualquer linha onde a coluna Data tem valor mas não é parseável como data — isso evita múltipla contagem independente de filtro de período.

## CPV e coluna `entregue` no consolidado
Para todos os tipos de compra (CPM, CPV), o engine lê `entregue` da **col 5 (Impressões)**. A col 9 (Views) é o numerador do VTR (views completos), não a métrica de entrega. Os parsers 00px CPV usam "Views" como sinônimo de total de plays = col 5.

## Comprovantes ADFORCE — CPV com colunas "Impressões" e "Entregues" separadas
Comprovantes CPV (ex.: TEADS) exportados pelo ADFORCE contêm **duas colunas distintas**:
- **Impressões** — exibições totais do anúncio (equivale ao `entregue` / col 5 do consolidado)
- **Entregues** — plays de vídeo (equivale ao `views` / col 9 do consolidado)
- **0%** — coluna de video plays que o parser mapeia para o campo `views`

O `parse_comprovante` prioriza "Impressões" para o campo `entregue`; só usa "Entregues" como fallback se "Impressões" não existir no cabeçalho.

## Tolerância a NaN no ADFORCE (`_load_workbook_safe`)
Alguns comprovantes ADFORCE contêm células `NaN` (resultado de `0/0` sem tratamento), que corrompem o XML do XLSX e fazem o openpyxl falhar. O `parser_adforce.py` usa `_load_workbook_safe()`: tenta carregar normalmente; se falhar, abre o arquivo como ZIP, remove `<v>NaN</v>` dos XMLs de worksheets e recarrega do buffer sanitizado.

## Datas como serial float (`parse_date` em `parser_utils.py`)
Quando openpyxl não reconhece o formato de data de uma célula (cell type `"n"` em vez de `"d"`), retorna o serial Excel como float (ex.: `46082.125` = 01/03/2026 03:00). `parse_date()` detecta floats no intervalo válido de datas Excel e converte via `openpyxl.utils.datetime.from_excel()`. Afeta todos os parsers que usam `parser_utils`.

## Layout multi-seção do arquivo de verification 00px
O arquivo de verification 00px tem duas linhas de cabeçalho (row 8 = seções, row 10 = colunas) e três seções de métricas na mesma sheet:
- **IMPRESSÕES | CPM** → col "Impressões" (preenchida apenas em linhas CPM)
- **CLIQUES | CPC** → col "Cliques"
- **VISUALIZAÇÕES | CPV** → col "Views" (preenchida apenas em linhas CPV)

`parse_verif` lê `impressoes = Impressões OR Views` por linha — usa o que não for zero. Isso garante que veículos CPV (ex.: Teads) tenham suas indevidas contadas corretamente.

**Atenção:** se o arquivo de verification incluir múltiplos Placement IDs, os totais de indevidas serão a soma de todos. Ex.: arquivo Teads com placements 152077 + 152078 soma ambos, mas o consolidado pode refletir apenas um deles — nesse caso a agência deve fornecer um arquivo filtrado por placement.

## Template 29 colunas (atualizado)
- Col 14: Conteúdo Sensível (novo — agregado geral)
- Cols 15–22: 8 categorias individuais (acidente, violencia, lingua_estrangeira, pornografia, safeframe, app_movel, teste_tag, nao_classificado)
- **Col 28**: Devolutiva BI SECOM (era col 27)
- Col 29: Devolutiva Agência

## CATEGORY_MAP centralizado
Em `app/verification/parsers/category_map.py` — único lugar para adicionar variantes de categoria.
Inclui strings compostas do ADFORCE (e.g. `"acidentes,violencia,crime"` sem espaços e `"pornografia, sexo, sexualidade"` → mapeados corretamente).

Mapas **por adserver** (`SENSE_CATEGORY_MAP`, `METRIKE_CATEGORY_MAP`, `ADFORCE_CATEGORY_MAP`) são usados com exclusividade quando `normaliza_categoria(texto, adserver=…)` recebe o adserver — categorias de conteúdo válido retornam `None` e caem em `verif_extras`. Sem `adserver`, vale o `CATEGORY_MAP` global (também usado na detecção de header do consolidado).

### SENSE (`SENSE_CATEGORY_MAP`)
Cobre labels das campanhas Always_on **e** Posicionamento junho:
- `Sensível` / `Conteúdo Sensível` → `conteudo_sensivel`
- `Violência` / `Policial` → `violencia`
- `Safeframe`, `Drogas`, `Pornografia`
- `Não Classificado` → `nao_classificado`
- `Teste Banner` / `Teste de Tag` → `teste_tag`

`Fora da Praça` no consolidado **não** é indevida de categoria (fica `None`).

## SENSE — multi-shape (`parser_sense.py`)

Detectar **sempre por conteúdo de header/sheet**, nunca por nome de campanha ou filename (filename só como hint de `tipo_compra` se meta falhar).

Fixtures em `verification/SENSE/`:
- `Always_on_20250064/` — C1 diário + V1 verif “curto”
- `Posicionamento_governo_junho/` — C2/C3 multi + V2/V3 verif largo/CPV

### Comprovante

| Shape | Campanha exemplo | Assinatura | Comportamento |
|---|---|---|---|
| **C1** diário 1-veículo | Always_on | sheet `*Contabilizações`; header `Data` + `Impressões`/`Válidas`; meta `Veículo:` | Soma linhas diárias; 1 dict; `formato_detectado=sense_comp_daily` |
| **C2** multi CPM | Junho | sheet `TOTAL POR VEÍCULO E PLACEMENT`; `Veículo`+`Impressões`/`Válidas`; **sem** `Data` | Só linhas-pai (placement filhos ignorados); N dicts; `sense_comp_multi` |
| **C3** multi CPV | Junho | mesmo multi; métrica `Views` + `Play`/`25%`/`50%`/`75%`/`100%` + `VA(IAB)` | `views` + quartis se existirem; `entregue` = Válidas \|\| Views |
| **C4** diário CPV (previsto) | — | diário com `Views` em vez de `Impressões` | Mesmo loop C1; colunas opcionais de quartis |

- `VA(IAB)` ∈ (0,1] → viewability em % (`×100`); se já for % usa direto.
- Multi sem coluna `Data` → filtros `ini`/`fim` são no-op (período só em meta).

### Verification

| Shape | Assinatura | Notas |
|---|---|---|
| **V1** curto | `TAG` + `Impressões válidas/indevidas` + `Total de impressões` | Always_on; sem meta Modelo de Compra |
| **V2** largo | + `ID Criativo` / `ID Placement` / `Placement` | Junho CPM; meta `Modelo de Compra: CPM` |
| **V3** CPV | `Visualizações válidas/indevidas` + `Total de visualizações` | seta `views=entregue`, `tipo_compra=CPV`, `formato_detectado=sense_verif_views` |

Sheet preferida: título com `simplificado`/`relatório`; fallback 1ª sheet com header `Categoria`+`Veículo`. Totais embutidos no header após `\n` — `_clean_header` usa só a 1ª linha.

### Consolidado SENSE

| Campanha | Indevidas no header (row 8) |
|---|---|
| Always_on | `Drogas`, `Pornografia`, `Safeframe`, `Sensível`, `Violência` |
| Junho CPM/CPV | `Conteúdo Sensível`, `Policial`, `Safeframe`, `Teste Banner`, `Não Classificado`, `Fora da Praça` |

CPV consolidado: col 5 Impressões costuma ser 0; métrica de entrega em **Views** (col 9).

### Performance / Vercel (504 5 min)
Lotes como junho somam **centenas de MB** de verif (ex.: R7 ~36 MB). openpyxl é CPU-bound.
- `engine.py`: com `praca=None`, **não** reparseia verification (antes o 2º pass unfiltered rodava sempre → 2× tempo). Com `praca` setado, mantém 2 passes (filtrado + unfiltered p/ DIF).
- Função Python `/api/py/verification` e Node `/api/verification/run` têm `maxDuration` ~300s. Lote full junho ainda pode apertar; se estourar de novo → job assíncrono (fora do parser).

### Smoke local
```bash
python3 app/verification/parsers/parser_sense.py comp \
  "verification/SENSE/Always_on_20250064/COMPROVANTE "/relatorio_veiculo_BRASIL\ 247*.xlsx
python3 app/verification/parsers/parser_sense.py comp \
  verification/SENSE/Posicionamento_governo_junho/COMPROVANTE/CPM.xlsx
python3 app/verification/parsers/parser_sense.py verif \
  verification/SENSE/Posicionamento_governo_junho/VERIFICATION/CPV/relatorio_verification_DEEZER_CPV_*.xlsx
python3 verification/test_regression.py   # baseline Always_on (C1/V1)
```

## Layouts de consolidado por adserver
Cada adserver pode usar um layout diferente de colunas no consolidado (posições de indevidas e devolutiva variam). O `engine.py` detecta as posições **dinamicamente** lendo o header da row 8 via `_detect_consolidado_cols(ws)`, que usa `normaliza_categoria()` para mapear nomes de colunas → chaves internas. Fallback para as constantes hardcoded do template padrão SECOM (29 colunas) quando o header não é reconhecido.

### ADFORCE (confirmado em `/verification/ADFORCE/`):
- Col 14: `Acidentes,Violencia,Crime` (combinado; padrão tem Acidente=15, Violência=16)
- Col 15: `Língua Estrangeira` | Col 16: `Politica` | Col 17: `Sexo/Pornografia`
- Col 27: Devolutiva BI SECOM (padrão: 28) | Col 28: URL info (padrão: 30)

### SENSE
Ver seção **SENSE — multi-shape** acima (Always_on vs Junho; detecção dinâmica de indevidas).

## Amostragem de URLs para AI check
- Parsers devolvem o pool completo de URLs indevidas (reservoir ≤ 10000 por arquivo)
- `engine.py` agrupa por categoria e amostra **30% por categoria indevida** (mín. 1), cap global 200
- `route.ts` envia ao Ollama `gemma4:31b-cloud` em paralelo (máx 50 URLs, batches de 10)
- Retorna `url_check_anomalies: [{url, categoria, reason}]` para a UI
- Categoria `safeframe` é tratada como limitação técnica (não conteúdo indevido) — o prompt da IA instrui a classificá-la sempre como CORRETA
- Usa `OLLAMA_BASE_URL` — se ausente, URL check é silenciosamente pulado
- **Não duplo-amostrar**: parsers nunca fazem sub-amostragem própria

## Detecção de header nos parsers de verif
- `_find_verif_header` exige `"categoria"` + variant de `"veículo"` na mesma linha (até row 25)
- **Não exige coluna "url"** — URL é enriquecimento opcional, não obrigatório para detectar formato
- Arquivos sem coluna "Url" no header (ex: R7, UOL METRIKE) são parseados normalmente

## Passagem de múltiplos arquivos ao engine.py
- `route.ts` usa `args.push('--comp', ...compPaths)` e `args.push('--verif', ...verifPaths)`
- **Não** usar loop `for p of paths: args.push('--flag', p)` — argparse com `nargs` sobrescreve a cada flag repetida

## Devolutiva — formato das linhas
- `OK campo: valor` — campo OK (verde na UI)
- `DIV campo: comprovante X / consolidado Y` — divergência (vermelho)
- `? indevidas: sem arquivo de verification` — verif não enviado
- `PENDENTE: ...` — sem comprovante nem verif

## Viewability no consolidado
- Excel armazena como decimal (0.7166). `_read_consolidado` normaliza: se ≤ 1.0 → multiplica por 100

## Filtros disponíveis na UI
- **Ano**: chips ano−1 e ano atual — ao trocar com mês selecionado, recalcula `ini`/`fim`
- **Mês**: chips Jan–Dez preenchem `ini`/`fim` automaticamente com o ano selecionado
- **Range manual**: campos DD/MM/AAAA — desseleciona chip de mês ao editar
- **Praça**: select com os 27 estados brasileiros (UF). Quando selecionado, `parse_verif` de **todos** os parsers (00px, ADFORCE, ADMOTION, AHEAD, METRIKE) descarta linhas onde a coluna `Estado`/`UF`/`State` existe e difere da sigla escolhida. Linhas sem valor nessa coluna passam normalmente (fallback seguro). Se o arquivo de verification não tiver coluna de estado, o filtro é silenciosamente ignorado.

## PostgreSQL (produção e desenvolvimento)
- **Neon** (serverless Postgres) — projeto `jarvis-secom`, região `sa-east-1`
- Host: `ep-raspy-poetry-acxtgwu0.sa-east-1.aws.neon.tech` — SSL obrigatório (`ssl: 'require'`)
- A detecção de SSL é automática: `lib/db/index.ts` e `drizzle.config.ts` aplicam SSL quando o host contém `neon.tech`
- Vercel: **https://jarvis-app-v2.vercel.app**