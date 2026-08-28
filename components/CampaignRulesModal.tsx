"use client";

import { useEffect, useState } from "react";
import HudCorners from "./HudCorners";

// Editor das regras de grupo de campanha (só ADMIN). O texto vai cru para
// `app_settings.campaign_group_rules` no Postgres; quem interpreta é lib/campaignGroups.
// ponytail: textarea puro em vez de editor de linhas — a ordem das regras É a semântica,
// e arrastar linha nenhuma bate a facilidade de recortar e colar num texto.

export default function CampaignRulesModal({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/dashboard/campaign-rules");
        if (!res.ok) throw new Error("Falha ao carregar as regras.");
        const json = await res.json();
        if (alive) setText(json.rules ?? "");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Falha ao carregar as regras.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/campaign-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative hud-panel rounded-[16px] w-full max-w-3xl max-h-[85dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Regras de grupo de campanha"
      >
        <HudCorners accent="cyan" size={16} inset={8} />

        <div className="px-5 py-4 border-b border-separator">
          <div className="font-hud text-[11px] uppercase tracking-[0.24em] text-ink flex items-center gap-2">
            <span style={{ color: "var(--hud-cyan)" }}>◇</span> Grupos de campanha
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
            Uma regra por linha: <code className="text-ink-2">TERMO + TERMO ={">"} Rótulo</code>.
            {" "}<code className="text-ink-2">+</code> é E; para OU, repita o rótulo em outra linha.
            Vence a <strong className="text-ink-2">primeira</strong> regra que casar, e o match
            ignora maiúsculas e acentos. Sem regra que case, o rótulo é o trecho entre o 1º e o
            2º <code className="text-ink-2">|</code> do nome. Linhas com <code className="text-ink-2">#</code> são comentário.
          </p>
        </div>

        <div className="flex-1 min-h-0 p-5">
          <textarea
            value={loading ? "Carregando…" : text}
            onChange={(e) => setText(e.target.value)}
            readOnly={loading}
            spellCheck={false}
            className="w-full h-full min-h-[280px] resize-none bg-fill border border-separator rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed font-mono text-ink focus:outline-none focus:border-accent-border"
          />
        </div>

        <div className="px-5 py-4 border-t border-separator flex items-center justify-between gap-3">
          <span className="text-[12px] text-danger">{error}</span>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-separator text-ink-3 hover:text-ink transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={save}
              disabled={saving || loading}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border bg-accent-soft border-accent-border text-accent-text disabled:opacity-50 transition-colors"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
