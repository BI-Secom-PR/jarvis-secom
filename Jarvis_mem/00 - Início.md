---
title: Jarvis SECOM — Segundo Cérebro
tags:
  - moc
  - home
aliases:
  - Home
  - Início
cssclasses:
  - home-dashboard
---

# Jarvis SECOM

> Assistente de dados para marketing analytics da SECOM.
> Consulta linguagem natural → SQL → 7 plataformas de mídia.

---

## Mapa do Conhecimento

### Projeto
- [[Visão Geral]] — o que é, para quem serve, stack
- [[Arquitetura]] — dual-DB, auth, routing, fluxo de dados

### AI Chat
- [[Pipeline do Chat]] — request → LLM → tool → SQL → resposta
- [[Modelos de IA]] — Groq, Google, tradeoffs, TPM limits
- [[Schema SQL]] — gold layer + silver layer completo

### Verificação de Campanhas
- [[Fluxo de Verificação]] — 3 arquivos, como funciona
- [[Template 30 Colunas]] — estrutura do consolidado SECOM
- [[Category Map]] — mapeamento de categorias indevidas
- Parsers: [[Parser 00px]] · [[Parser ADFORCE]] · [[Parser ADMOTION]] · [[Parser AHEAD]] · [[Parser METRIKE]] · [[Parser BRZ]]

### Banco de Dados
- [[Gold Layer]] — tabelas normalizadas cross-platform
- [[Silver Layer]] — dados nativos por plataforma
- [[PostgreSQL Local]] — auth, sessões, Docker

### Dev
- [[Setup e Comandos]] — como rodar, variáveis de ambiente
- [[Arquivos Chave]] — mapa de arquivos críticos

### Histórico
- [[Bugs e Fixes]] — problemas encontrados e soluções

---

## Status Rápido

| Área | Status |
|---|---|
| AI Chat — tool calling | ✅ corrigido (system prompt explícito) |
| Silver layer no chat | ✅ exposto (schema documentado) |
| Verificação 00px | ✅ subtotais + CPV corrigidos |
| Verificação METRIKE | ✅ date filter + double-count corrigidos |
| Parser BRZ | ⏳ pendente (NotImplementedError) |
| Testes automatizados | ❌ não existe |
