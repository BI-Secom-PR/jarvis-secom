"use client";

import { useEffect, useMemo, useState } from "react";
import HudCorners from "./HudCorners";
import { availableColumns, bothCampaignAndAd, COMBINED_LABEL, DATASETS, EXPORT_COLUMNS, SOURCE_OF, type ColKey, type ExportDataset, type FieldProbe } from "@/lib/dashboardExport";

// Escolhe conjuntos + colunas e baixa o .xlsx de /api/dashboard/export com os filtros
// que estão na tela. O catálogo (rótulos, colunas por conjunto) vive em lib/dashboardExport
// — o mesmo que a rota usa para montar as abas.

export type ExportFilters = {
  from: string; to: string;
  campaign: string[]; platform: string[]; ad: string[]; objective: string[]; tema: string[];
};

const DATASET_KEYS = Object.keys(DATASETS) as ExportDataset[];

export default function DashboardExportModal({ filters, initial, onClose }: {
  filters: ExportFilters;
  /** Conjunto da aba ativa — vem marcado por padrão. */
  initial: ExportDataset;
  onClose: () => void;
}) {
  const [datasets, setDatasets] = useState<ExportDataset[]>([initial]);
  const [columns, setColumns] = useState<ColKey[]>(DATASETS[initial].default);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Sonda: quais métricas o recorte filtrado realmente tem. Enquanto ela não volta,
  // `null` = oferece tudo (ver availableColumns).
  const [probe, setProbe] = useState<FieldProbe | null>(null);
  const [probing, setProbing] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Uma sonda por abertura do modal — os filtros não mudam enquanto ele está aberto.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/dashboard/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...filters, probe: true }),
          signal: ctrl.signal,
        });
        const json = (await res.json()) as { fields?: FieldProbe | null };
        if (!ctrl.signal.aborted) setProbe(json.fields ?? null);
      } catch {
        // sonda é best-effort: sem ela o modal continua oferecendo todas as colunas
      } finally {
        if (!ctrl.signal.aborted) setProbing(false);
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Conjunto sem nenhuma métrica no recorte (ex.: Pinterest não reporta região). */
  const emptyDataset = (d: ExportDataset) => !!probe && !probe[SOURCE_OF[d]]?.length;

  // A aba ativa vem marcada antes da sonda responder; se ela não tem dado no recorte,
  // desmarca — exportar uma aba vazia não é o que ninguém quis.
  useEffect(() => {
    if (probe) setDatasets((ds) => ds.filter((d) => probe[SOURCE_OF[d]]?.length));
  }, [probe]);

  // União das colunas dos conjuntos marcados, na ordem do CATÁLOGO — não na dos
  // conjuntos, senão marcar Região depois jogava UF/Estado lá para o fim da lista.
  const available = useMemo(() => {
    const wanted = new Set(datasets.flatMap((d) => availableColumns(d, probe)));
    return (Object.keys(EXPORT_COLUMNS) as ColKey[]).filter((c) => wanted.has(c));
  }, [datasets, probe]);

  const selected = columns.filter((c) => available.includes(c));

  function toggleDataset(d: ExportDataset) {
    const on = datasets.includes(d);
    setDatasets(on ? datasets.filter((x) => x !== d) : [...datasets, d]);
    // Marcar um conjunto novo traz as colunas padrão dele junto, senão o usuário ganha
    // uma aba com as colunas de outro conjunto e nada da dimensão nova.
    if (!on) setColumns((cs) => [...new Set([...cs, ...availableColumns(d, probe).filter((c) => DATASETS[d].default.includes(c))])]);
  }

  const toggleColumn = (c: ColKey) =>
    setColumns((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  async function download() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...filters, datasets, columns: selected }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `Dashboard SECOM ${filters.from} a ${filters.to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao gerar o Excel.");
    } finally {
      setBusy(false);
    }
  }

  const check =
    "flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer select-none hover:text-ink transition-colors";
  const box = "w-3.5 h-3.5 accent-[var(--hud-cyan)] cursor-pointer";
  const btn =
    "px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-separator bg-fill text-ink-3 hover:text-ink transition-colors";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative hud-panel rounded-[16px] w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <HudCorners accent="cyan" size={16} inset={8} />

        <div className="px-5 md:px-6 pt-5 pb-3 flex items-center justify-between gap-3">
          <div className="font-hud text-[11px] uppercase tracking-[0.24em] text-ink flex items-center gap-2"
               style={{ textShadow: "0 0 12px color-mix(in srgb, var(--hud-cyan) 35%, transparent)" }}>
            <span style={{ color: "var(--hud-cyan)" }}>◇</span> Exportar dados
          </div>
          <button onClick={onClose} className="text-ink-3 hover:text-ink transition-colors text-[16px] leading-none">×</button>
        </div>

        <div className="px-5 md:px-6 pb-2 text-[11px] text-ink-3">
          {`Período ${filters.from} a ${filters.to}, com os filtros da tela. Cada conjunto vira uma aba do arquivo, com todas as linhas do recorte — não só as 50 da tabela. A lista de colunas mostra só o que as plataformas filtradas reportam.`}
        </div>

        <div className="flex-1 overflow-y-auto px-5 md:px-6 py-4 space-y-5">
          <div>
            <div className="font-hud text-[9px] uppercase tracking-[0.22em] text-ink-3 mb-2.5">Conjuntos</div>
            <div className="grid grid-cols-2 gap-2">
              {DATASET_KEYS.map((d) => {
                const off = emptyDataset(d);
                return (
                  <label key={d} className={off ? `${check} opacity-40 cursor-not-allowed` : check}>
                    <input type="checkbox" className={box} disabled={off}
                      checked={datasets.includes(d)} onChange={() => toggleDataset(d)} />
                    {DATASETS[d].label}
                    {off && <span className="text-[10px] text-ink-3">sem dados no recorte</span>}
                  </label>
                );
              })}
            </div>
            {bothCampaignAndAd(datasets) && (
              <p className="mt-2.5 text-[11px] text-ink-3">
                {`Campanhas e Anúncios marcados juntos saem numa aba só (“${COMBINED_LABEL}”), uma linha por anúncio com a campanha ao lado.`}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <div className="font-hud text-[9px] uppercase tracking-[0.22em] text-ink-3">
                Colunas {probing ? "· conferindo o recorte…" : selected.length ? `· ${selected.length}` : ""}
              </div>
              <div className="flex gap-2">
                <button className={btn} onClick={() => setColumns(available)}>Todas</button>
                <button className={btn} onClick={() => setColumns([])}>Nenhuma</button>
              </div>
            </div>
            {available.length ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                {available.map((c) => (
                  <label key={c} className={check}>
                    <input type="checkbox" className={box} checked={columns.includes(c)} onChange={() => toggleColumn(c)} />
                    <span className="truncate">{EXPORT_COLUMNS[c].label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-ink-3">Escolha ao menos um conjunto acima.</p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-ink">{error}</div>
          )}
        </div>

        <div className="px-5 md:px-6 py-4 border-t border-separator flex items-center justify-end gap-2">
          <button className={btn} onClick={onClose} disabled={busy}>Cancelar</button>
          <button
            onClick={download}
            disabled={busy || !datasets.length || !selected.length}
            className="px-4 py-1.5 rounded-lg text-[12px] font-semibold border bg-accent-soft border-accent-border text-accent-text hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? "Gerando…" : "Baixar Excel"}
          </button>
        </div>
      </div>
    </div>
  );
}
