---
title: Fluxo de Verificação
tags:
  - verificacao
  - fluxo
---

# Verificação de Campanhas

Rota `/verification` — completamente isolada do `/chat`.

## Os 3 Arquivos

```
1. Consolidado (.xlsx)
   └── Template SECOM 30 colunas
       gerado pelas agências

2. Comprovante(s) (.xlsx)  [1 ou mais]
   └── Relatório de entrega do adserver

3. Verification URL(s) (.xlsx)  [opcional, 1 ou mais]
   └── categoria + URL por linha
```

## Fluxo de Dados

```
UI seleciona adserver + envia arquivos
      ↓
POST /api/verification/run
      ↓
Salva arquivos em /tmp
      ↓
Spawn engine.py --adserver X --comp [...] --verif [...]
      ↓
engine.py:
  ├── _read_consolidado()      ← lê template 30 cols
  ├── PARSER_MAP[adserver].parse_comprovante()
  ├── PARSER_MAP[adserver].parse_verif()   (se enviado)
  ├── Compara entregue, viewability, indevidas
  └── Gera devolutiva por linha
      ↓
route.ts lê stdout JSON + stderr (logs)
      ↓
Groq llama-3.1-8b-instant verifica URLs indevidas (se GROQ_API_KEY)
      ↓
UI exibe resultado com DevolutivaLines (cores: verde/vermelho)
```

## Devolutiva — Formato das Linhas

| Prefixo | Significado | Cor |
|---|---|---|
| `OK campo: valor` | Campo correto | Verde |
| `DIV campo: comp X / consol Y` | Divergência | Vermelho |
| `? indevidas: sem arquivo de verification` | Verif não enviado | Amarelo |
| `PENDENTE: ...` | Sem comprovante nem verif | Cinza |

## Amostragem de URLs para AI Check

```
Parsers → pool completo (≤ 500 URLs por arquivo)
      ↓
engine.py agrupa por categoria
      ↓
5% por categoria indevida (mín. 1), cap global 200
      ↓
route.ts → Groq llama-3.1-8b-instant
  batches de 10, máx 50 URLs paralelo
      ↓
url_check_anomalies: [{ url, categoria, reason }]
```

> [!warning] Não duplo-amostrar
> Parsers NUNCA fazem sub-amostragem própria. Só o engine.py amostra.

## Passagem de Múltiplos Arquivos

```typescript
// CORRETO
args.push('--comp', ...compPaths)
args.push('--verif', ...verifPaths)

// ERRADO — argparse com nargs sobrescreve a cada flag repetida
for (p of paths) args.push('--flag', p)
```

## Viewability no Consolidado

Excel armazena como decimal (0.7166 = 71,66%).
`_read_consolidado` normaliza: se valor ≤ 1.0 → multiplica por 100.

---

Ver também: [[Template 30 Colunas]] · [[Category Map]] · Parsers: [[Parser 00px]] · [[Parser ADFORCE]] · [[Parser METRIKE]]
