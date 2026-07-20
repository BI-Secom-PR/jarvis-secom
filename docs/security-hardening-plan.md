# Plano de hardening de segurança — Jarvis SECOM

**Status:** pronto para implementação  
**Origem:** análise de segurança (sessão 2026-07-17)  
**Regra:** não misturar com features; PRs pequenos e verificáveis  
**Deploy alvo:** Vercel (multi-instance) + on-prem opcional

---

## Como usar na segunda

1. Começar pelo **P0** (bloqueadores reais de abuso).
2. Cada item tem **arquivos**, **o quê fazer**, **como validar**.
3. Preferir 1–2 PRs: `security/p0-ssrf-upload` → `security/p1-rate-limit-auth` → `security/p2-polish`.
4. Live-verify: login, chat SQL, verification Blob + on-prem, sentimentos correct.

**Estimativa bruta**

| Bloco | Esforço | Quando |
|-------|---------|--------|
| P0 | ~2–3 h | Segunda manhã |
| P1 | ~3–4 h | Segunda tarde |
| P2 | ~2 h | Terça ou se sobrar tempo |
| P3 | backlog | Quando couber |

---

## P0 — Corrigir antes de qualquer outra coisa

Vazamento de token / SSRF e path traversal: um usuário autenticado já consegue abusar.

### P0.1 — Allowlist de URLs de Blob + não vazar `BLOB_READ_WRITE_TOKEN`

**Risco:** SSRF + exfiltração do token de escrita do Vercel Blob (Bearer em qualquer URL).

**Arquivos**

- `app/api/verification/run/route.ts`
- `api/py/verification.py`

**Fazer**

1. Helper TS (e espelho em Python) `isAllowedBlobUrl(url)`:
   - só `https:`
   - host termina com `.blob.vercel-storage.com` ou `.public.blob.vercel-storage.com` (ajustar se o domínio real do projeto for outro)
   - rejeitar `localhost`, IPs privados, `file:`, redirects não validados
2. Validar **todas** as URLs do body JSON (`consolidado_url`, `comp_urls[]`, `verif_urls[]`) **antes** de chamar o engine; 400 se qualquer uma falhar.
3. Em Python, **revalidar** a mesma allowlist em `_download_url` (defense in depth — não confiar só no Node).
4. Só enviar `blob_token` / header `Authorization` se a URL passou na allowlist.
5. Ideal: não confiar em URL arbitrária do client — se possível, só paths que o app gerou no upload (suffix aleatório já existe).

**Validar**

- [ ] URL legítima de Blob → verification roda.
- [ ] `https://example.com/x` → 400, sem download.
- [ ] `http://169.254.169.254/` → 400.
- [ ] Com URL atacante: logs/proxy **não** mostram request com Bearer do blob token.

---

### P0.2 — Path traversal em nomes de arquivo (on-prem)

**Risco:** `path.join(tmpDir, file.name)` com `../` escreve fora do tmp.

**Arquivos**

- `app/api/verification/run/route.ts` (branch FormData / spawn)
- `api/py/verification.py` (se monta path com `consol_name` / nomes do client)

**Fazer**

1. Nunca usar `file.name` cru no filesystem.
2. Padrão: `path.join(tmpDir, `${randomUUID()}${ext}`)` onde `ext` é whitelist (`.xlsx`, `.xls`, `.csv` se necessário).
3. Nome original só para display / `output_name`, nunca para path.
4. Em Python: `os.path.basename` + rejeitar se contiver `..` ou separadores.

**Validar**

- [ ] Upload normal de xlsx → engine OK.
- [ ] Nome `../../tmp-escape.xlsx` → grava só dentro do `secom-verif-*` tmp.

---

### P0.3 — DELETE de blobs sem ownership

**Risco:** qualquer sessão autenticada apaga qualquer URL de Blob que souber.

**Arquivo:** `app/api/verification/blob-upload/route.ts`

**Fazer**

1. No DELETE: aplicar a **mesma allowlist** de host (P0.1).
2. Opcional mas melhor: prefixar uploads com `userId/` no `pathname` do token e só permitir `del` de URLs cujo path começa com esse prefixo (se a API do Blob expuser path).
3. Rate limit simples no DELETE (ex. 20/min por user).

**Validar**

- [ ] DELETE de URL própria / allowlisted → ok.
- [ ] DELETE de `https://evil.com` → 400.
- [ ] Sem sessão → 401.

---

## P1 — Auth, brute force e abuso de custo

### P1.1 — Rate limit que funciona em multi-instance

**Risco:** `lib/rateLimit.ts` em memória por processo; na Vercel o limite real é N×instâncias.

**Arquivos**

- `lib/rateLimit.ts`
- opcional: `lib/rateLimitStore.ts` (Upstash Redis / Vercel KV)
- env: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (ou equivalente)

**Fazer**

1. Manter API atual: `rateLimit(key, limit, windowMs)`.
2. Backend:
   - se env Redis/KV presente → contador compartilhado (fixed window ou sliding simples);
   - senão → fallback in-memory (dev/on-prem single node) + log de aviso em prod se Redis ausente.
3. Não quebrar `tooManyRequests` / header `Retry-After`.
4. Documentar vars no README / env example (sem secrets).

**Validar**

- [ ] Duas “instâncias” (ou dois deploys) compartilham contagem em login.
- [ ] Local sem Redis ainda limita (Map).
- [ ] 429 com `Retry-After` legível.

---

### P1.2 — Endurecer brute force de login

**Arquivos**

- `app/api/auth/login/route.ts`
- `lib/rateLimit.ts` (keys)

**Fazer**

1. Manter: IP 20/15min + IP+email 5/15min.
2. **Adicionar** limite por e-mail global: ex. **10 falhas / 15 min** (qualquer IP) — trava stuffing distribuído na mesma conta.
3. Corrigir **DUMMY_HASH**: gerar uma vez com `bcrypt.hashSync('dummy-constant-timing', 12)` e commitar o hash real (não string inválida).
4. Garantir que falha de compare no dummy não vaze stack (try/catch → false).
5. Opcional: após N falhas da conta, delay artificial 1–2s (cuidado com DoS de workers).

**Validar**

- [ ] 6ª tentativa no mesmo IP+email → 429.
- [ ] 11ª falha no mesmo email com IPs diferentes (simular headers se possível) → 429 na key global.
- [ ] E-mail inexistente e senha errada: resposta idêntica e latência similar.

---

### P1.3 — `change-password`: rate limit + revogar sessões

**Arquivo:** `app/api/auth/change-password/route.ts`

**Fazer**

1. Rate limit: ex. 5/15min por `userId` (e 10/15min por IP).
2. Após sucesso: `DELETE FROM sessions WHERE user_id = ?` e **criar** nova sessão (ou manter só a atual e apagar as outras — preferível).
3. Cookie de sessão reemitido se as outras forem mortas e a atual também for apagada.
4. `newPassword` max length alinhado ao register (128) e min 8.

**Validar**

- [ ] Senha errada 6× → 429.
- [ ] Troca ok → sessão em outro browser cai; browser atual continua ou reloga limpo.
- [ ] Admin reset (já revoga) não regrediu.

---

### P1.4 — Rate limit + caps nos endpoints caros

| Rota | Sugestão |
|------|----------|
| `/api/chat` | 20 req / 10 min por user; body `chatInput` max ~8–16k chars; history cap |
| `/api/tts` | 10 req / 10 min por user; `text` max 500–1000 chars |
| `/api/verification/run` | 5 req / 10 min por user; já tem `maxDuration` |
| `/api/sentimentos/ai-filter` | já tem text 500 — só rate limit 30/min |
| `/api/external/query` | já tem 30/min IP — ok; revisar se key vazar |

**Arquivos:** rotas acima + `lib/rateLimit.ts`

**Validar**

- [ ] Chat normal funciona.
- [ ] TTS com texto enorme → 400.
- [ ] Rajada de chat → 429 sem estourar cota Google/Ollama.

---

### P1.5 — SQL guard do agente (chat + external)

**Risco:** allowlist de tool é só prompt; código não força `gold_*`.

**Arquivos**

- `app/api/chat/route.ts` (`SAFE_QUERY` / `BLOCKED_PATTERNS` / `executeSql`)
- `app/api/external/query/route.ts` (duplicar a mesma função — extrair helper)

**Fazer**

1. Extrair `lib/sqlGuard.ts`:
   - deve começar com `SELECT` ou `WITH`
   - deve conter `FROM`
   - bloquear: `UNION…SELECT`, `SLEEP`, `BENCHMARK`, `INFORMATION_SCHEMA`, `mysql.`, `sys.`, `performance_schema`, `INTO OUTFILE/DUMPFILE`, `LOAD_FILE`, `;` (multi-statement), comentários `--` / `/*`
   - **exigir** que todo `FROM`/`JOIN` aponte para identificador `gold_%` (regex cuidadosa; permitir aliases)
   - manter bloqueio de `gold_platforms_` se ainda for regra de produto (views classificadas)
2. Usar o mesmo guard em chat e external.
3. Mensagem de erro estável (sem ecoar SQL completo em prod se quiser).

**Validar**

- [ ] `SELECT … FROM gold_campaigns_classified` → ok.
- [ ] `SELECT … FROM silver_social_comments` → rejeitado.
- [ ] `SELECT … FROM gold_x; DROP…` → rejeitado.
- [ ] Query com comentário `--` → rejeitado.
- [ ] Chat real de performance ainda funciona (few-shots do agent).

---

## P2 — Hardening de sessão, passkey e DX de API

### P2.1 — APIs com `requireAuth` não devem redirectar HTML

**Arquivos:** `lib/auth.ts` + rotas que usam `requireAuth` em `/api/*`

**Fazer**

- `requireAuthApi()` → 401 JSON se sem sessão (em vez de `redirect('/login')`).
- Migrar: `chat-sessions/*`, `exports/*`, admin se aplicável.

**Validar:** `curl` sem cookie em `/api/chat-sessions` → `401` JSON, não HTML do login.

---

### P2.2 — Cookie de sessão

**Arquivos:** login + passkey finish (set cookie)

**Fazer**

- Confirmar `secure: true` em prod, `httpOnly`, `sameSite: 'lax'`, `path: '/'`.
- Opcional: prefixo `__Host-jarvis_session` (exige secure + path `/` + sem Domain) — só se não quebrar deploys multi-host.
- Não setar `Domain=.algo.com` aberto.

---

### P2.3 — Passkey: user verification

**Arquivo:** `app/api/auth/passkey/login/finish/route.ts` (+ register se aplicável)

**Fazer**

- `requireUserVerification: true` se os devices SECOM suportarem (testar YubiKey/Touch ID/Windows Hello).
- Se UX quebrar em algum notebook corporativo, documentar exceção e manter false só em dev.

---

### P2.4 — Política de senha (leve)

**Arquivos:** register, change-password, admin password patch

**Fazer**

- min 8 (já existe); max alinhado.
- Rejeitar senha === e-mail.
- Opcional: lista curta de senhas proibidas (`12345678`, `password`, `senha1234`).
- Não bloquear caracteres especiais (bcrypt trunca em 72 bytes — documentar).

---

### P2.5 — Menos vazamento em erros/logs

**Arquivos:** `app/api/verification/run/route.ts`, `app/api/chat/route.ts`, passkey finish

**Fazer**

- Em prod: não devolver stack/trace do Python ao client; log só no server.
- Passkey: não devolver `detail: String(err)` cru.
- Chat: `console.log('[SQL]')` → em prod logar hash/length ou desligar; evitar PII em plain text.

---

### P2.6 — Middleware `/api/verification`

**Arquivo:** `proxy.ts`

**Fazer**

- Hoje verification é “public” no matcher e confia no `getSession` da rota.
- Opção A (mínima): comentário + checklist para nunca esquecer `getSession`.
- Opção B: **remover** `/api/verification/` da lista pública e exigir cookie no edge (Blob webhook de upload-completed já é assinado — confirmar que não quebra).

**Validar:** unauthenticated POST `/api/verification/run` → 401 em qualquer camada.

---

## P3 — Backlog (não bloquear segunda)

| ID | Item | Nota |
|----|------|------|
| P3.1 | CAPTCHA / Turnstile no login após 3 falhas | Se stuffing for real na internet aberta |
| P3.2 | Alerting de 429 em massa (Sentry/log drain) | Ops |
| P3.3 | Revisar grants MySQL RO (só `gold_*` SELECT) | Defesa no banco, não só no app |
| P3.4 | Rotação de `EXTERNAL_API_KEY` / `INTERNAL_API_KEY` | Runbook |
| P3.5 | WAF / rate limit na edge Vercel | Complementa P1.1 |
| P3.6 | Session list “sair de todos os dispositivos” na UI | UX de P1.3 |
| P3.7 | Testes automatizados do `sqlGuard` + `isAllowedBlobUrl` | Hoje não há suite — scripts pequenos bastam |
| P3.8 | Dependabot / `bun audit` no CI | Supply chain |

---

## Ordem sugerida na segunda (checklist)

```text
Manhã
  [ ] P0.1 Allowlist Blob + token
  [ ] P0.2 Basename / UUID nos paths
  [ ] P0.3 DELETE blobs
  [ ] Smoke: verification Blob em staging/prod preview

Tarde
  [ ] P1.1 Rate limit Redis/KV (ou issue se credencial não pronta → P1.2/1.4 no Map primeiro)
  [ ] P1.2 Login global + dummy hash
  [ ] P1.3 Change-password
  [ ] P1.4 Caps chat/tts/verification
  [ ] P1.5 lib/sqlGuard.ts + wiring

Se sobrar
  [ ] P2.1 requireAuthApi
  [ ] P2.5 Erros/logs
  [ ] Commit/PR com nota de segurança
```

---

## Critérios de “done” do dia

- [ ] Nenhuma URL arbitrária é fetchada pelo verification com Bearer do Blob.
- [ ] Nenhum path de upload usa `file.name` cru.
- [ ] Login tem limite por conta (não só IP+email).
- [ ] Chat/TTS/verification têm teto de abuso.
- [ ] SQL do agente rejeita `silver_*` e multi-statement no código.
- [ ] Smoke manual: login, 1 chat com gráfico, 1 verification (adserver de teste), change-password.

---

## Fora de escopo deste plano

- Redesign de auth (OAuth SECOM, SSO).
- Reescrever engine Python.
- Mudanças de produto no chat/KPI.
- Pentest formal / bug bounty.

---

## Referência rápida de arquivos

| Área | Paths |
|------|--------|
| Rate limit | `lib/rateLimit.ts` |
| Auth/sessão | `lib/auth.ts`, `app/api/auth/**` |
| Edge/CSP | `proxy.ts`, `next.config.ts` |
| SQL AI | `app/api/chat/route.ts`, `app/api/external/query/route.ts` → `lib/sqlGuard.ts` |
| Verification | `app/api/verification/run/route.ts`, `blob-upload/route.ts`, `api/py/verification.py` |
| MySQL | `lib/mysql.ts` (grants: infra, não app) |

---

*Plano gerado a partir da análise de segurança; implementar sem reabrir o debate de prioridade a menos que P0 quebre o fluxo Blob em prod — aí ajustar allowlist de host, não remover a checagem.*
