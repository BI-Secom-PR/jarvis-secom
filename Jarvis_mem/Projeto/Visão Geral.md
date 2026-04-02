---
title: Visão Geral do Projeto
tags:
  - projeto
  - overview
---

# Visão Geral — Jarvis SECOM

**Jarvis** é um assistente de dados para a SECOM que permite consultar campanhas de marketing digital em linguagem natural. O usuário pergunta em português, o AI gera e executa SQL, e retorna dados formatados com suporte a gráficos inline.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 16 (App Router) |
| Package manager | Bun (`bun.lock`) — npm scripts também funcionam |
| Auth DB | PostgreSQL via Drizzle ORM |
| Analytics DB | MySQL — data warehouse `airbyte_secom` (read-only) |
| AI | Vercel AI SDK — Groq + Google Generative AI |
| Charts | Recharts |
| Email | Resend |

## Módulos Principais

```
/chat         → consulta analytics via AI
/verification → verificação de campanhas (arquivos Excel)
/admin        → gestão de usuários
```

> [!info] Isolamento entre módulos
> `/verification` e `/chat` são completamente isolados — não compartilham estado, API nem lógica. Qualquer feature que envolva os dois deve ser tratada como integração explícita.

## Plataformas Suportadas

| Plataforma | Alias aceito |
|---|---|
| Meta | facebook, fb, instagram |
| Google | google ads, google adwords |
| TikTok | tiktok |
| Kwai | kwai |
| LinkedIn | linkedin |
| Pinterest | pinterest |
| Amazon DSP | amazon_dsp |

## Usuários e Roles

- **USER** — acesso a `/chat` e `/verification`
- **ADMIN** — acesso a `/admin` (gestão de usuários)

Usuários desabilitados têm sessões invalidadas imediatamente.

---

Próximo: [[Arquitetura]]
