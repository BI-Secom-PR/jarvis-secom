# TODO — Sistema de Verificação de Consolidados SECOM

Acompanhamento do desenvolvimento. Marcar com `[x]` ao concluir cada item.

**Última sessão:** 2026-03-23
**Estado:** Etapas 1–4 concluídas. Próximo: validação local completa na UI (`npm run dev` → `/verification` → testar RS).

**Stack Python:** parser_vetta · parser_tabular · parser_nacional · parser_auto → engine.py
**Stack Next.js:** `app/api/verification/run/route.ts` → `components/VerificationContainer.tsx`

---

## Etapa 1 — Infraestrutura e Documentação
- [x] Criar este arquivo de tracking
- [x] Mapear formatos de comprovante existentes (VETTA, Tabular, CM360)
- [x] Documentar estrutura de linhas de total/subtotal por formato
- [x] Atualizar CLAUDE.md da pasta verification

---

## Etapa 1b — Template de Consolidado

> Template padrão a ser enviado para as agências preencherem. **Não gerar arquivos pré-populados** — as agências entregam o template preenchido.

- [x] Criar `TEMPLATE - Consolidado Verification.xlsx` baseado no modelo Nacional
- [x] 28 colunas com sistema de cores pastel, fórmulas e dropdown Tipo de Compra
- [x] Definir 8 categorias individuais de indevidas (substituiu coluna "Impróprio" agregada)
- [x] Documentar mapeamento de variantes de categoria no CLAUDE.md
- [x] Criar `Consolidado Verification - RS.xlsx` com dados reais do RS (referência de teste)
- [x] Remover arquivos pré-populados gerados por engano (Nacional, Propeg, Nova, Calia)

**Estrutura do template (28 colunas):**

| Cols | Grupo | Cor |
|------|-------|-----|
| 1–4 | Veículo, Praça, Tipo de Compra, Contratado | Cinza `EBEBEB` |
| 5–12 | Impressões, % Entregue, Cliques, CTR, Views, VTR, Viewables, Viewability | Pêssego `FDDCB5` |
| 13–21 | Entregas Válidas + 8 categorias de indevidas | Amarelo mel `FFF3CC` |
| 22–24 | % Indevidas, Total Indevidas, Dif% | Amarelo / Rosa `F8BBBB` |
| 25–26 | Data Inicial, Data Final | Amarelo mel |
| 27 | Devolutiva BI SECOM | Azul `C5D9F5` |
| 28 | Devolutiva Agência | Âmbar `FFE5A0` |

**Categorias de indevidas (cols 14–21):**
Acidente | Violência | Língua Estrangeira | Pornografia | Safeframe | Aplicativo Móvel | Teste de Tag | Não Classificado

**Regra CPM/CPV:**
- CPM → preencher Impressões (col 5); Views vazio
- CPV → preencher Views (col 9); Impressões vazio

---

## Etapa 2 — Parsers de Comprovante

> Cada parser testável via `python parser_xxx.py <comprovante> --verif <verif1> [verif2...]`
> Retorna JSON normalizado. Nunca usar totais do adserver — somar linhas diárias.

### `parser_vetta.py` ✅ CONCLUÍDO
- [x] Detectar sheet "Contabilizações" (CPM ou CPV)
- [x] Pular linhas com `#TOTAL` em qualquer coluna
- [x] Extrair `contratado` da linha de metadados ("Total contratado: X.XXX.XXX")
- [x] Extrair `viewability` da linha `#TOTAL POR VEÍCULO` (coluna `VA (IAB)`)
- [x] Somar métricas diárias: entregue, cliques, viewables
- [x] Indevidas lidas de arquivos `Verification - *.xlsx` separados (não do Comprovante)
- [x] `CATEGORY_MAP` com todas as variantes → 8 categorias SECOM
- [x] Suporte a múltiplos arquivos `--verif` (Part 1, Part 2, etc.)
- [x] Suporte a filtro `--ini` / `--fim`
- [x] Teste com Bora Brasil (CPM) — todos os valores conferem ✓
- [x] Teste com PicPay Ads (CPM) — todos os valores conferem ✓
- [x] Teste com Teads (CPV) — todos os valores conferem ✓

**Resultado validado RS Dezembro:**

| Veículo | Contratado | Entregue | Cliques | Viewables | Viewability | App Móvel |
|---------|-----------|---------|---------|-----------|-------------|-----------|
| Bora Brasil | 1.440.576 | 1.577.754 | 3.850 | 1.142.878 | 72% | 226.162 |
| PicPay Ads | 420.000 | 1.000.352 | 1.722 | 923.760 | 92% | 918.516 |
| Teads | 139.485 | 155.872 | 411 | 123.796 | 79% | 63.947 |

**Interface do parser:**
```python
parse(
    filepath,            # Comprovante Veículo .xlsx
    verif_paths=[...],   # Lista de Verification - *.xlsx separados
    data_ini=None,       # date opcional
    data_fim=None,       # date opcional
) -> dict
```

---

### `parser_tabular.py` ✅ CONCLUÍDO
- [x] Localizar header ~linha 6 com colunas: Veículo, Placement, Canal, Formato, etc.
- [x] Pular linha com `"-"` em col[0] (grand total)
- [x] Somar métricas por veículo (CPM=Impressões, CPV=Entregues)
- [x] Extrair contratado / viewability / viewables do bloco de metadados (células adjacentes)
- [x] Suporte a filtro por data
- [x] Teste com: `BALANÇO DO GOVERNO FEDERAL PANORAMAS ESTADUAIS - Teads.xlsx` ✓
- [x] Teste com: `BALANÇO DO GOVERNO FEDERAL PANORAMAS ESTADUAIS - PERNAMBUCO.COM.xlsx` ✓
- [x] Teste com: `BALANÇO DO GOVERNO FEDERAL PANORAMAS ESTADUAIS - DIÁRIO DE PERNAMBUCO.xlsx` ✓

**Resultado validado PE:**

| Veículo | Tipo | Contratado | Entregue | Cliques | Viewables | Viewability |
|---------|------|-----------|---------|---------|-----------|-------------|
| Teads | CPV | 123.863 | 113.748 | 274 | 100.924 | 86,3% |
| PERNAMBUCO.COM | CPM | 1.000.000 | 579.221 | 108 | 27.098 | 4,7% |
| DIÁRIO DE PERNAMBUCO | CPM | 2.172.005 | 1.028.101 | 34.770 | 359.820 | 35,0% |

**Observação:** formato tabular não contém dados de indevidas por categoria — indevidas ficam zeradas.

### `parser_nacional.py` ✅ CONCLUÍDO
- [x] Detectar sheet "Worksheet" com colunas Veículo + VA%
- [x] Header dinâmico (~linha 11)
- [x] Multi-veículo: retorna `list[dict]`, um por veículo
- [x] Extrair contratado + viewability da linha `#TOTAL POR VEÍCULO` de cada veículo
- [x] Somar métricas diárias por veículo
- [x] Suporte a filtro por data
- [x] Teste com: `POSICIONAMENTO ESTADUAL RJ-BI - CPM - DEZEMBRO.xlsx` — 18 veículos ✓

**Observação:** formato sem dados de indevidas por categoria.

### `parser_auto.py` ✅ CONCLUÍDO
- [x] Detectar VETTA → sheet com "Contabilizações": delegar parser_vetta
- [x] Detectar Nacional → sheet "Worksheet" + colunas Veículo/VA%: delegar parser_nacional
- [x] Detectar Tabular → header ~linha 6 com colunas Placement: delegar parser_tabular
- [x] Se nenhum: retornar erro com nome do arquivo + motivo
- [x] Interface unificada: sempre retorna `list[dict]` (VETTA/Tabular embrulhados em lista)
- [x] Teste com VETTA (Bora Brasil RS) ✓
- [x] Teste com Tabular (Teads PE) ✓
- [x] Teste com Nacional (RJ CPM — 18 veículos) ✓

**`parser_cm360.py`** — ⏸ DEFERIDO
> Formato CM360 (coluna `Sensitive Category`) não encontrado nos arquivos atuais (RS/CE/PE/RJ).
> Implementar quando aparecerem arquivos desse formato.

**Interface unificada dos parsers:**
```python
parse(
    filepath,            # Comprovante .xlsx
    verif_paths=[...],   # Verification separados (apenas VETTA)
    data_ini=None,       # date opcional
    data_fim=None,       # date opcional
) -> list[dict]          # um dict por veículo
```

---

## Etapa 3 — Engine de Comparação

> Motor central: recebe consolidado + lista de comprovantes → retorna divergências

### `engine.py` ✅ CONCLUÍDO
- [x] Ler consolidado (28 colunas) via openpyxl — preserva fórmulas/formatação
- [x] Separar arquivos em comprovantes vs `Verification - *.xlsx` automaticamente
- [x] Associar verif → comprovante por fuzzy match no nome do arquivo
- [x] Parsear todos os comprovantes via `parser_auto.parse()` (retorna list[dict])
- [x] Normalizar nomes: uppercase, sem acento, sem pontuação, sem sufixos S.A./LTDA
- [x] Match fuzzy com `token_set_ratio` (threshold 85%) — lida com nomes subset/superset
- [x] Detectar veículo no consolidado sem comprovante correspondente → PENDENTE
- [x] Detectar comprovante sem veículo no consolidado
- [x] Comparar entregue (tolerância 2%) + 8 categorias indevidas
- [x] Escrever devolutiva na coluna 27 (Devolutiva BI SECOM)
- [x] Salvar como `<nome>_verificado.xlsx` (original intacto)
- [x] Teste RS: 3 veículos — Bora Brasil OK ✓, PicPay Ads OK ✓, Teads OK ✓

**Resultado validado RS:**
```
VEÍCULO          STATUS  MATCH                        SCORE
Bora Brasil      OK      Bora brasil - programatica   100
PicPay Ads       OK      Picpay ads                   100
Teads            OK      Teads                        100
```

---

## Etapa 4 — Interface no Jarvis (Next.js)

> Rota: `/verification` | Arquivos: `app/verification/page.tsx` + `app/api/verification/run/route.ts`

- [x] **UI — `components/VerificationContainer.tsx`**
  - [x] FileDrop consolidado (single) + FileDrop comprovantes/verif (multi) com drag-and-drop
  - [x] Filtro de data opcional (data_ini / data_fim)
  - [x] Botão "Verificar" com estado disabled/loading
  - [x] Tabela de resultados: OK verde, DIVERGENCIA vermelho, PENDENTE âmbar
  - [x] Devolutiva por linha na tabela
  - [x] Botão "Baixar consolidado verificado" (base64 → blob download)
  - [x] Avisos para comprovantes sem consolidado e erros de parse

- [x] **API — `app/api/verification/run/route.ts`**
  - [x] Receber `consolidado` + `files[]` via multipart/form-data
  - [x] Salvar temporariamente em `/tmp/secom-verif-<uuid>/`
  - [x] Chamar `engine.py` via `child_process.spawn`
  - [x] Retornar JSON com veiculos, avisos, arquivo verificado em base64
  - [x] Limpeza automática do diretório temporário no finally

- [ ] **Validação local completa** ← PRÓXIMO
  - [ ] Testar fluxo completo na UI com RS (3 veículos)
  - [ ] Testar com CE (comprovante multi-sheet VETTA)
  - [ ] Testar com veículo no consolidado sem comprovante correspondente
  - [ ] Testar com comprovante sem veículo no consolidado

---

## Etapa 5 — Google Drive (após Etapa 4 validada)

> Substituir file picker local por Google Drive API. Lógica de parsers/engine não muda.

- [ ] Criar projeto no Google Cloud Console
- [ ] Habilitar Drive API + Picker API
- [ ] Configurar OAuth 2.0 Client ID (Web application)
- [ ] Adicionar variáveis `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` ao `.env`
- [ ] Implementar botão "Conectar Google Drive" com OAuth flow
- [ ] Integrar Google Picker API para seleção visual do consolidado
- [ ] Backend: download do `.xlsx` via `googleapis` + access token
- [ ] Após verificação: upload do consolidado verificado de volta ao Drive (mesmo `fileId`)
- [ ] Teste com colaborador em máquina diferente

---

## Referências

**Arquivos de teste (RS):**
```
RS/PÓS-VENDA/VERIFICATION/
├── Consolidado Verification - RS.xlsx          ← consolidado no padrão do template (gerado)
├── Devolutiva SECOM _ Consolidado...xlsx       ← consolidado original da agência (referência)
└── 1. DEZEMBRO/1ª RODADA/
    ├── 6991 - CAMPANHA .../
    │   ├── 6991 - BORA BRASIL - PROGRAMATICA/
    │   │   └── Comprovante Veículo - BORA BRASIL - PROGRAMATICA .xlsx
    │   ├── 6991 - PicPay Ads/
    │   │   └── Comprovante Veículo - PicPay Ads.xlsx
    │   └── 6991 - Teads/
    │       └── Comprovante Veículo - Teads.xlsx
    └── Verification Dezembro/
        ├── BORA BRASIL - PROGRAMATICA/
        │   ├── Verification - BORA BRASIL - PROGRAMATICA _Part 1.xlsx
        │   └── Verification - BORA BRASIL - PROGRAMATICA _Part 2.xlsx
        ├── PicPay Ads/
        │   └── Verification - PicPay Ads_Part 1.xlsx
        └── Teads/
            └── Verification - Teads_Part 1.xlsx
```

**Formatos mapeados:**

| Formato | Identificação | Métricas de entrega | Indevidas |
|---------|--------------|---------------------|-----------|
| VETTA | Sheet "Contabilizações"; linhas com `#TOTAL` ignoradas | Soma linhas diárias; viewability do `#TOTAL POR VEÍCULO` | Arquivos `Verification - *.xlsx` separados |
| Tabular | Header ~linha 6, coluna Placement UUID | Linha com `"-"` em col[0] ignorada | A definir |
| CM360 | Coluna `Sensitive Category` | Nenhuma linha de total | Por `Sensitive Category` |

**Mapeamento de categorias (todas as variantes → chave SECOM):**

| Chave SECOM | Variantes nos arquivos |
|-------------|------------------------|
| `acidente` | Acidente, Acidentes Violentos |
| `violencia` | Crime, Crime Violento, Violência, Violência e Criminalidade |
| `lingua_estrangeira` | Conteúdo em Língua Estrangeira, Idioma Estrangeiro ou Traduzido |
| `pornografia` | Pornografia, Sexo e Sexualidade, Conteúdo Adulto e Sexual |
| `safeframe` | Safeframe |
| `app_movel` | Aplicativo Móvel, Aplicativo Movel |
| `teste_tag` | Teste de Tag |
| `nao_classificado` | Não Classificado, Indeterminado |
