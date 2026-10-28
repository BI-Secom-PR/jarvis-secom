"use client";

import { useCallback, useEffect, useState } from "react";
import HudCorners from "./HudCorners";
import { platformLabel } from "@/lib/dashboard";

// Editor dos orçamentos do pacing (`gold_campaign_budgets`). Qualquer usuário logado edita;
// cada alteração vira `manual` (o job diário não sobrescreve) e entra na auditoria.

type Budget = {
  id: number | null; platform: string; level: "campaign" | "ad_group"; campaign_id: string; ad_group_id: string | null;
  name: string; budget_total: string | null; budget_type: "lifetime" | "daily";
  start_date: string | null; end_date: string | null; source_amount: string | null;
  source: "auto" | "manual" | null; updated_by: string | null; updated_at: string | null;
};
type Hist = { id: number; action: string; old_values: unknown; new_values: unknown; changed_by: string; changed_at: string };

const day = (v: string | null) => (v ? v.slice(0, 10) : "");
const brl = (v: string | number | null) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
// Máscara de centavos PT-BR: digita-se só números ("26890663" → "268.906,63").
const maskBrl = (v: string) => {
  const digits = v.replace(/\D/g, "").slice(0, 12);
  return digits ? (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
};
const fmtAmount = (v: string | number | null) => (v == null ? "" : maskBrl(String(Math.round(Number(v) * 100))));
const parseBrl = (v: string) => Number(v.replace(/\./g, "").replace(",", "."));
const inputCls ="bg-fill border border-separator rounded-md px-2 py-1 text-[12px] text-ink focus:outline-none focus:border-accent-border";
const btnCls = "px-2.5 py-1 rounded-md text-[11px] font-semibold border border-separator text-ink-3 hover:text-ink transition-colors disabled:opacity-50";

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function Row({ b, onChanged, onError }: { b: Budget; onChanged: () => void; onError: (m: string) => void }) {
  const isNew = b.id == null;
  const [amount, setAmount] = useState(fmtAmount(b.budget_total));
  const [start, setStart] = useState(day(b.start_date));
  const [end, setEnd] = useState(day(b.end_date));
  const [type, setType] = useState(b.budget_type);
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<Hist[] | null>(null);
  const dirty = isNew ? amount.trim() !== "" : parseBrl(amount) !== Number(b.budget_total) || start !== day(b.start_date) || end !== day(b.end_date) || type !== b.budget_type;
  const diverge = b.source === "manual" && b.source_amount != null && Number(b.source_amount) !== Number(b.budget_total);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); onChanged(); } catch (e) { onError(e instanceof Error ? e.message : "Falha"); } finally { setBusy(false); }
  }

  return (
    <div className="px-5 py-3 border-b border-separator space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] text-ink truncate" title={b.name}>{b.name || b.ad_group_id || b.campaign_id}</div>
          <div className="text-[10.5px] text-ink-3">
            {platformLabel(b.platform)} · {b.level === "campaign" ? "campanha" : "conjunto"} · {b.ad_group_id ?? b.campaign_id}
            {" · "}{isNew ? "sem orçamento" : b.source === "manual" ? `ajustado por ${b.updated_by ?? "?"}` : "automático"}
            {diverge && <span className="text-ink-2"> · origem diz {brl(b.source_amount)}</span>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputCls} w-32 tabular-nums`} inputMode="decimal" value={amount} onChange={(e) => setAmount(maskBrl(e.target.value))} placeholder="0,00" aria-label="Valor" />
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as Budget["budget_type"])} aria-label="Tipo">
          <option value="lifetime">total</option><option value="daily">diário</option>
        </select>
        <input className={inputCls} type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Início" />
        <input className={inputCls} type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Fim" />
        <button className={btnCls} disabled={!dirty || busy}
          onClick={() => run(() => isNew
            ? call("POST", "/api/dashboard/budgets", { platform: b.platform, level: b.level, campaign_id: b.campaign_id, ad_group_id: b.ad_group_id, name: b.name, budget_total: parseBrl(amount), budget_type: type, start_date: start || null, end_date: end || null })
            : call("PUT", "/api/dashboard/budgets", { id: b.id, budget_total: parseBrl(amount), budget_type: type, start_date: start || null, end_date: end || null }))}>
          {isNew ? "Cadastrar" : "Salvar"}
        </button>
        {!isNew && (
          <>
            <button className={btnCls} disabled={busy}
              onClick={async () => { if (hist) return setHist(null); try { setHist((await call("GET", `/api/dashboard/budgets?history=${b.id}`)).history); } catch (e) { onError(e instanceof Error ? e.message : "Falha"); } }}>
              Histórico
            </button>
            <button className={btnCls} disabled={busy}
              onClick={() => { if (confirm("Apagar este orçamento? O job automático não vai recriá-lo.")) run(() => call("DELETE", `/api/dashboard/budgets?id=${b.id}`)); }}>
              Apagar
            </button>
          </>
        )}
      </div>
      {hist && (
        <ul className="text-[11px] text-ink-3 space-y-0.5">
          {hist.length === 0 && <li>Sem alterações registradas.</li>}
          {hist.map((h) => (
            <li key={h.id}>
              {new Date(h.changed_at).toLocaleString("pt-BR")} · <span className="text-ink-2">{h.changed_by}</span> · {h.action}
              {" "}<code className="text-ink-3">{JSON.stringify(h.old_values)} → {JSON.stringify(h.new_values)}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BudgetsModal({ filters, onClose, onSaved }: {
  /** Os mesmos filtros do dashboard — o modal lista as campanhas que eles deixam passar. */
  filters: Record<string, string | string[]>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Budget[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) for (const x of Array.isArray(v) ? v : [v]) if (x) qs.append(k, x);
    try {
      const json = await call("GET", `/api/dashboard/budgets?${qs}`);
      setRows(json.budgets); setTruncated(json.truncated); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao carregar."); } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changed = () => { onSaved(); load(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative hud-panel rounded-[16px] w-full max-w-4xl max-h-[88dvh] flex flex-col" onClick={(e) => e.stopPropagation()}
           role="dialog" aria-modal="true" aria-label="Orçamentos do pacing">
        <HudCorners accent="cyan" size={16} inset={8} />
        <div className="px-5 py-4 border-b border-separator space-y-2">
          <div className="font-hud text-[11px] uppercase tracking-[0.24em] text-ink flex items-center gap-2">
            <span style={{ color: "var(--hud-cyan)" }}>◇</span> Orçamentos
          </div>
          <p className="text-[12px] leading-relaxed text-ink-3">
            Mostra as campanhas do recorte atual do dashboard (período e filtros). Os valores chegam sozinhos das
            plataformas; ao ajustar, o seu valor passa a valer, o automático não o sobrescreve e a alteração fica
            registrada com o seu e-mail. Onde não há origem (Kwai, YouTube) a linha vem vazia — cadastre aqui.
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && <div className="px-5 py-4 text-[12px] text-ink-3">Carregando…</div>}
          {!loading && rows.length === 0 && <div className="px-5 py-4 text-[12px] text-ink-3">Nenhuma campanha com entrega neste recorte.</div>}
          {rows.map((b) => <Row key={`${b.platform}|${b.campaign_id}|${b.ad_group_id ?? ""}:${b.id}:${b.updated_at}`} b={b} onChanged={changed} onError={setError} />)}
          {truncated && <div className="px-5 py-3 text-[11px] text-ink-3">Recorte grande: mostrando só as primeiras campanhas. Filtre mais para ver as demais.</div>}
        </div>

        <div className="px-5 py-3 border-t border-separator flex items-center justify-between gap-3">
          <span className="text-[12px] text-danger">{error}</span>
          <button onClick={onClose} className={btnCls}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
