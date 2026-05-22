"use client";

import { useState, useEffect } from "react";
import { upload } from "@vercel/blob/client";
import Link from "next/link";

type VehicleResult = {
  veiculo: string;
  status: "OK" | "DIVERGENCIA" | "PENDENTE";
  devolutiva: string;
  match: string | null;
  score: number;
  formato?: string;
};

type UrlAnomaly = {
  url: string;
  categoria: string;
  reason: string;
  impressoes?: number;
  pct?: number;
};

type VerificationResult = {
  veiculos: VehicleResult[];
  sem_comprovante: string[];
  sem_consolidado: string[];
  parse_errors: { arquivo: string; erro: string }[];
  file_base64: string | null;
  file_name: string;
  url_check_anomalies: UrlAnomaly[];
};

type ViewRule = {
  veiculo: string;
  criterio: "start" | "50" | "100";
  secundagem: string;
};

const CRITERIO_OPTIONS: { value: ViewRule["criterio"]; label: string }[] = [
  { value: "start", label: "Start do vídeo (0%)" },
  { value: "50", label: "50% visualizado" },
  { value: "100", label: "100% completo" },
];

const STATUS_COLORS: Record<string, string> = {
  OK: "text-emerald-400",
  DIVERGENCIA: "text-rose-400",
  PENDENTE: "text-amber-400",
};

const STATUS_BG: Record<string, string> = {
  OK: "bg-emerald-500/10 border-emerald-500/20",
  DIVERGENCIA: "bg-rose-500/10 border-rose-500/20",
  PENDENTE: "bg-amber-500/10 border-amber-500/20",
};

function FileDrop({
  label,
  accept,
  multiple,
  onChange,
  files,
}: {
  label: string;
  accept: string;
  multiple: boolean;
  onChange: (files: File[]) => void;
  files: File[];
}) {
  const [dragging, setDragging] = useState(false);

  function handleFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list).filter((f) => f.name.endsWith(".xlsx"));
    if (picked.length) onChange(multiple ? picked : [picked[0]]);
  }

  const hasFiles = files.length > 0;

  return (
    <div
      className={`relative rounded-xl transition-all select-none overflow-hidden
        ${
          dragging
            ? "border border-[rgba(120,180,255,0.5)] bg-[rgba(120,180,255,0.06)] shadow-[0_0_0_1px_rgba(120,180,255,0.15)]"
            : hasFiles
              ? "border border-[rgba(120,180,255,0.2)] bg-white/3 hover:border-[rgba(120,180,255,0.32)]"
              : "border border-dashed border-white/15 bg-white/2 hover:border-white/30 hover:bg-white/3"
        }`}
    >
      {/* Input transparente cobre toda a área — clique + drag handlers direto no input */}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      />

      {/* Label strip */}
      <div className={`px-4 pt-3 pb-2 border-b ${hasFiles ? "border-white/6" : "border-transparent"}`}>
        <p className="text-[10px] text-white/55 font-semibold uppercase tracking-widest">
          {label}
        </p>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {!hasFiles ? (
          <div className="flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0 text-white/35">
              <path d="M9 11.5V4M6 6.5 9 3.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 12.5v1A1.5 1.5 0 0 0 4.5 15h9a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <p className="text-sm text-white/45">
              {multiple ? "Arraste arquivos" : "Arraste o arquivo"}{" "}
              <span className="text-white/58">ou clique</span>
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {files.map((f, i) => (
              <li
                key={`${i}-${f.name}`}
                className="flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-[rgba(120,180,255,0.5)]">
                  <path d="M7 1H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4L7 1Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                  <path d="M7 1v3h3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                </svg>
                <span className="text-sm text-white/85 truncate">{f.name}</span>
                <span className="text-[10px] text-white/42 ml-auto shrink-0 tabular-nums">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Regex: captura (prefixo) (campo) (resto) de linhas da devolutiva
const DEVOLUTIVA_LINE_RE = /^(OK|DIV|DIF|\?)\s+([^:]+):(.*)$/;

function difColorByPct(pctValue: number | null): string {
  if (typeof pctValue !== "number" || !Number.isFinite(pctValue)) {
    return "text-amber-400/70";
  }
  const absPct = Math.abs(pctValue);
  if (absPct === 0) return "text-[#00fff7]";
  if (absPct <= 5) return "text-[#ffae00]";
  return "text-[#ff1c1c]";
}

function DevolutivaLines({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean);
  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        const m = line.match(DEVOLUTIVA_LINE_RE);
        if (m) {
          const [, prefix, campo, rest] = m;
          const isOk = prefix === "OK";
          const isDiv = prefix === "DIV";
          const isDif = prefix === "DIF";
          const pctMatch = rest.match(/\(([+-]?\d+(?:[.,]\d+)?)%\)/);
          const pctValue = pctMatch
            ? Number.parseFloat(pctMatch[1].replace(",", "."))
            : null;
          const color = isOk
            ? "text-emerald-400"
            : isDiv
              ? "text-rose-400"
              : isDif
                ? difColorByPct(pctValue)
                : "text-amber-400/70";
          return (
            <div key={i} className="text-xs leading-relaxed">
              <span className={`font-bold ${color}`}>{prefix}</span>{" "}
              <span className={`font-semibold ${color}`}>{campo.trim()}:</span>
              <span className="text-white/68">{rest}</span>
            </div>
          );
        }
        // Linhas sem prefixo (PENDENTE, OK —, etc.)
        const isPendente = line.startsWith("PENDENTE");
        return (
          <div
            key={i}
            className={`text-xs leading-relaxed ${
              isPendente ? "text-amber-400 font-medium" : "text-white/58 italic"
            }`}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
}

const ADSERVERS: { id: string; label: string; disabled?: boolean }[] = [
  { id: "00px", label: "00px" },
  { id: "adforce", label: "ADFORCE" },
  { id: "admotion", label: "ADMOTION" },
  { id: "ahead", label: "AHEAD" },
  { id: "metrike", label: "METRIKE" },
  { id: "brz", label: "BRZ", disabled: true },
];

const LOADING_STEPS = [
  "Lendo e validando arquivos...",
  "Cruzando veículos com o consolidado...",
  "Comparando métricas e categorias indevidas...",
  "Verificando URLs com IA...",
  "Gerando arquivo verificado...",
];

const MONTHS = [
  { label: "Jan", num: 1 },
  { label: "Fev", num: 2 },
  { label: "Mar", num: 3 },
  { label: "Abr", num: 4 },
  { label: "Mai", num: 5 },
  { label: "Jun", num: 6 },
  { label: "Jul", num: 7 },
  { label: "Ago", num: 8 },
  { label: "Set", num: 9 },
  { label: "Out", num: 10 },
  { label: "Nov", num: 11 },
  { label: "Dez", num: 12 },
];

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export default function VerificationContainer() {
  const currentYear = new Date().getFullYear();
  const [adserver, setAdserver] = useState<string | null>(null);
  const [consolidado, setConsolidado] = useState<File[]>([]);
  const [comprovantes, setComprovantes] = useState<File[]>([]);
  const [verifs, setVerifs] = useState<File[]>([]);
  const [ini, setIni] = useState("");
  const [fim, setFim] = useState("");
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [urlSamplePct, setUrlSamplePct] = useState(10);
  const [viewRules, setViewRules] = useState<ViewRule[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [anomaliesOpen, setAnomaliesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function formatInt(value?: number): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(
      value,
    );
  }

  function formatPct(value?: number): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return `${new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)}%`;
  }

  function selectYear(year: number) {
    setSelectedYear(year);
    if (selectedMonth !== null) {
      const pad = (n: number) => String(n).padStart(2, "0");
      const last = lastDayOfMonth(year, selectedMonth);
      setIni(`${pad(1)}/${pad(selectedMonth)}/${year}`);
      setFim(`${pad(last)}/${pad(selectedMonth)}/${year}`);
    }
  }

  function selectMonth(num: number) {
    if (selectedMonth === num) {
      setSelectedMonth(null);
      setIni("");
      setFim("");
      return;
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    const last = lastDayOfMonth(selectedYear, num);
    setSelectedMonth(num);
    setIni(`${pad(1)}/${pad(num)}/${selectedYear}`);
    setFim(`${pad(last)}/${pad(num)}/${selectedYear}`);
  }

  function handleManualDate(field: "ini" | "fim", value: string) {
    setSelectedMonth(null);
    if (field === "ini") setIni(value);
    else setFim(value);
  }

  useEffect(() => {
    if (!loading) {
      setLoadingStep(0);
      return;
    }
    const id = setInterval(() => {
      setLoadingStep((s) => (s + 1) % LOADING_STEPS.length);
    }, 3200);
    return () => clearInterval(id);
  }, [loading]);

  async function handleVerificar() {
    if (!adserver || !consolidado[0] || comprovantes.length === 0) return;
    setLoading(true);
    setLoadingStep(0);
    setUploadProgress(null);
    setError(null);
    setResult(null);

    try {
      if (process.env.NEXT_PUBLIC_USE_BLOB_UPLOAD) {
        // Upload files directly to Vercel Blob (bypasses 4.5 MB function limit)
        const allFiles = [consolidado[0], ...comprovantes, ...verifs];
        setUploadProgress({ done: 0, total: allFiles.length });

        const blobUpload = async (file: File) => {
          const b = await upload(file.name, file, {
            access: "public",
            handleUploadUrl: "/api/verification/blob-upload",
          });
          setUploadProgress((p) => p && { ...p, done: p.done + 1 });
          return b.url;
        };

        const consolidadoUrl = await blobUpload(consolidado[0]);
        const compUrls: string[] = [];
        for (const f of comprovantes) compUrls.push(await blobUpload(f));
        const verifUrls: string[] = [];
        for (const f of verifs) verifUrls.push(await blobUpload(f));
        setUploadProgress(null);

        const res = await fetch("/api/verification/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adserver,
            consolidado_url: consolidadoUrl,
            consolidado_name: consolidado[0].name,
            comp_urls: compUrls,
            verif_urls: verifUrls,
            ...(ini ? { ini } : {}),
            ...(fim ? { fim } : {}),
            url_sample_pct: urlSamplePct,
            ...(viewRules.length > 0 ? { view_rules: JSON.stringify(viewRules) } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setResult(data);
      } else {
        // On-prem: multipart FormData (no size restriction)
        const form = new FormData();
        form.append("adserver", adserver);
        form.append("consolidado", consolidado[0]);
        for (const f of comprovantes) form.append("comprovante", f);
        for (const f of verifs) form.append("verif", f);
        if (ini) form.append("ini", ini);
        if (fim) form.append("fim", fim);
        form.append("url_sample_pct", String(urlSamplePct));
        if (viewRules.length > 0)
          form.append("view_rules", JSON.stringify(viewRules));

        const res = await fetch("/api/verification/run", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  }

  function handleDownload() {
    if (!result?.file_base64) return;
    const binary = atob(result.file_base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.file_name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleReset() {
    setAdserver(null);
    setConsolidado([]);
    setComprovantes([]);
    setVerifs([]);
    setIni("");
    setFim("");
    setSelectedYear(currentYear);
    setSelectedMonth(null);
    setUrlSamplePct(10);
    setViewRules([]);
    setResult(null);
    setError(null);
  }

  const canSubmit =
    !!adserver && consolidado.length > 0 && comprovantes.length > 0 && !loading;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden relative nebula-bg">
      {/* Header */}
      <header className="shrink-0 flex items-center gap-2.5 px-6 py-4 border-b border-white/[0.07]">
        <Link
          href="/"
          className="text-xs text-white/52 hover:text-white/75 transition-colors"
        >
          Início
        </Link>
        <span className="text-white/28 text-xs">›</span>
        <h1 className="text-xs font-semibold text-white/82 tracking-wide">
          Verificação de Consolidados
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
          {/* Seletor de Adserver */}
          <div className="space-y-2">
            <span className="text-xs text-white/62 font-medium uppercase tracking-wider">
              Adserver
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {ADSERVERS.map((a) => (
                <button
                  key={a.id}
                  disabled={a.disabled}
                  onClick={() =>
                    !a.disabled && setAdserver(a.id === adserver ? null : a.id)
                  }
                  title={a.disabled ? "Em breve" : undefined}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                    a.disabled
                      ? "border-white/8 text-white/20 cursor-not-allowed"
                      : adserver === a.id
                        ? "bg-[rgba(120,180,255,0.18)] border-[rgba(120,180,255,0.4)] text-[rgba(120,180,255,0.95)]"
                        : "bg-white/4 border-white/10 text-white/65 hover:text-white/90 hover:border-white/28"
                  }`}
                >
                  {a.label}
                  {a.disabled ? " ↗" : ""}
                </button>
              ))}
            </div>
          </div>

          {/* Uploads */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FileDrop
              label="Consolidado"
              accept=".xlsx"
              multiple={false}
              onChange={setConsolidado}
              files={consolidado}
            />
            <FileDrop
              label="Comprovante(s)"
              accept=".xlsx"
              multiple={true}
              onChange={setComprovantes}
              files={comprovantes}
            />
            <FileDrop
              label="Verification URL(s) — opcional"
              accept=".xlsx"
              multiple={true}
              onChange={setVerifs}
              files={verifs}
            />
          </div>

          {/* % de URLs analisadas */}
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs text-white/62 font-medium uppercase tracking-wider shrink-0">
              % URLs analisadas por IA
            </span>
            <div className="flex items-center gap-1">
              <button
                id="decreaseButton"
                type="button"
                onClick={() => setUrlSamplePct((v) => Math.max(0, v - 5))}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-white/4 border border-white/10 text-white/65 hover:bg-white/8 hover:text-white/92 hover:border-white/25 active:bg-white/12 transition-all disabled:opacity-30"
                disabled={urlSamplePct === 0}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                  <path d="M3.75 7.25a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Z" />
                </svg>
              </button>
              <input
                type="number"
                min={0}
                max={100}
                value={urlSamplePct}
                onChange={(e) =>
                  setUrlSamplePct(Math.max(0, Math.min(100, Number(e.target.value))))
                }
                className="w-14 bg-white/5 border border-white/15 rounded-md py-1 text-sm text-white/88 text-center focus:outline-none focus:border-white/35 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                id="increaseButton"
                type="button"
                onClick={() => setUrlSamplePct((v) => Math.min(100, v + 5))}
                className="w-7 h-7 flex items-center justify-center rounded-md bg-white/4 border border-white/10 text-white/65 hover:bg-white/8 hover:text-white/92 hover:border-white/25 active:bg-white/12 transition-all disabled:opacity-30"
                disabled={urlSamplePct === 100}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                  <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                </svg>
              </button>
            </div>
            <span className="text-xs text-white/48">
              {urlSamplePct === 0 ? "analisa todas as URLs" : `${urlSamplePct}% por categoria`}
            </span>
          </div>
          {/* Regras de Visualização */}
          <div className="space-y-2">
            <button
              onClick={() => setRulesOpen((o) => !o)}
              className="flex items-center gap-2 text-xs text-white/60 hover:text-white/80 transition-colors font-medium uppercase tracking-wider"
            >
              <span>{rulesOpen ? "▾" : "▸"}</span>
              Regras de Visualização
              {viewRules.length > 0 && (
                <span className="bg-[rgba(120,180,255,0.2)] text-[rgba(120,180,255,0.8)] rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                  {viewRules.length}
                </span>
              )}
            </button>
            {rulesOpen && (
              <div className="space-y-2 pl-4 border-l border-white/10">
                {viewRules.map((rule, idx) => (
                  <div key={idx} className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      placeholder="Veículo"
                      value={rule.veiculo}
                      onChange={(e) =>
                        setViewRules((rs) =>
                          rs.map((r, i) =>
                            i === idx ? { ...r, veiculo: e.target.value } : r,
                          ),
                        )
                      }
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/85 placeholder:text-white/35 focus:outline-none focus:border-white/35 w-40"
                    />
                    <select
                      value={rule.criterio}
                      onChange={(e) =>
                        setViewRules((rs) =>
                          rs.map((r, i) =>
                            i === idx
                              ? {
                                  ...r,
                                  criterio: e.target
                                    .value as ViewRule["criterio"],
                                }
                              : r,
                          ),
                        )
                      }
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/85 focus:outline-none focus:border-white/35"
                    >
                      {CRITERIO_OPTIONS.map((o) => (
                        <option
                          key={o.value}
                          value={o.value}
                          className="bg-[#1a1a2e]"
                        >
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      placeholder="Seg. (ex: 60)"
                      value={rule.secundagem}
                      onChange={(e) =>
                        setViewRules((rs) =>
                          rs.map((r, i) =>
                            i === idx
                              ? { ...r, secundagem: e.target.value }
                              : r,
                          ),
                        )
                      }
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/85 placeholder:text-white/35 focus:outline-none focus:border-white/35 w-32"
                    />
                    <button
                      onClick={() =>
                        setViewRules((rs) => rs.filter((_, i) => i !== idx))
                      }
                      className="text-white/45 hover:text-rose-400 transition-colors text-sm px-1"
                      title="Remover regra"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    setViewRules((rs) => [
                      ...rs,
                      { veiculo: "", criterio: "100", secundagem: "" },
                    ])
                  }
                  className="text-xs text-[rgba(120,180,255,0.75)] hover:text-[rgba(120,180,255,0.95)] transition-colors"
                >
                  + Adicionar regra
                </button>
              </div>
            )}
          </div>

          {/* Filtro de período (opcional) */}
          <div className="space-y-3">
            {/* Chips de ano */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-white/62 font-medium uppercase tracking-wider shrink-0 mr-1">
                Ano
              </span>
              {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                <button
                  key={y}
                  onClick={() => selectYear(y)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                    selectedYear === y
                      ? "bg-[rgba(120,180,255,0.18)] border-[rgba(120,180,255,0.4)] text-[rgba(120,180,255,0.95)]"
                      : "bg-white/4 border-white/10 text-white/60 hover:text-white/85 hover:border-white/28"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
            {/* Chips de mês */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-white/62 font-medium uppercase tracking-wider shrink-0 mr-1">
                Mês
              </span>
              {MONTHS.map((m) => (
                <button
                  key={m.num}
                  onClick={() => selectMonth(m.num)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
                    selectedMonth === m.num
                      ? "bg-[rgba(120,180,255,0.18)] border-[rgba(120,180,255,0.4)] text-[rgba(120,180,255,0.95)]"
                      : "bg-white/4 border-white/10 text-white/60 hover:text-white/85 hover:border-white/28"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {/* Range manual */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/48 shrink-0">ou</span>
              <input
                type="text"
                placeholder="DD/MM/AAAA"
                value={ini}
                onChange={(e) => handleManualDate("ini", e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/85 placeholder:text-white/38 focus:outline-none focus:border-white/35 w-36"
              />
              <span className="text-white/48 text-sm">até</span>
              <input
                type="text"
                placeholder="DD/MM/AAAA"
                value={fim}
                onChange={(e) => handleManualDate("fim", e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/85 placeholder:text-white/38 focus:outline-none focus:border-white/35 w-36"
              />
            </div>
          </div>

          {/* Botão */}
          <button
            onClick={handleVerificar}
            disabled={!canSubmit}
            className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all duration-200
              bg-[rgba(120,180,255,0.12)] hover:bg-[rgba(120,180,255,0.18)]
              border border-[rgba(120,180,255,0.22)] hover:border-[rgba(120,180,255,0.48)]
              text-[rgba(120,180,255,0.85)] hover:text-white
              shadow-[0_0_0_0_rgba(120,180,255,0)] hover:shadow-[0_0_24px_rgba(120,180,255,0.12)]
              disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            Verificar
          </button>

          {/* Animação de carregamento */}
          {loading && (
            <div className="flex flex-col items-center gap-5 py-6">
              {/* Spinner */}
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-2 border-white/8" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[rgba(120,180,255,0.7)] animate-spin" />
                <div className="absolute inset-[6px] rounded-full border border-transparent border-t-[rgba(120,180,255,0.3)] animate-spin [animation-duration:1.5s]" />
              </div>
              {/* Etapa atual */}
              <div className="flex flex-col items-center gap-1.5">
                <p className="text-sm text-[rgba(120,180,255,0.8)] font-medium animate-pulse">
                  {uploadProgress
                    ? `Enviando arquivos... ${uploadProgress.done}/${uploadProgress.total}`
                    : LOADING_STEPS[loadingStep]}
                </p>
                <p className="text-xs text-white/45">
                  Isso pode levar alguns segundos...
                </p>
              </div>
              {/* Indicador de progresso */}
              <div className="flex gap-1.5">
                {LOADING_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 rounded-full transition-all duration-700 ${
                      i === loadingStep
                        ? "w-5 bg-[rgba(120,180,255,0.7)]"
                        : i < loadingStep
                          ? "w-1.5 bg-[rgba(120,180,255,0.35)]"
                          : "w-1.5 bg-white/10"
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-rose-400 font-medium">Erro</p>
                  <p className="text-xs text-rose-300/70 mt-1 whitespace-pre-wrap">
                    {error}
                  </p>
                </div>
                <button
                  onClick={handleReset}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-rose-500/20 text-rose-400/60 hover:text-rose-300 hover:border-rose-400/40 transition-colors"
                >
                  Tentar novamente
                </button>
              </div>
            </div>
          )}

          {/* Resultados */}
          {result && (
            <div className="space-y-4">
              {/* Resumo */}
              <div className="flex items-center justify-between">
                <div className="flex gap-4 text-xs text-white/68">
                  <span>
                    <span className="text-emerald-400 font-semibold">
                      {result.veiculos.filter((v) => v.status === "OK").length}
                    </span>{" "}
                    OK
                  </span>
                  <span>
                    <span className="text-rose-400 font-semibold">
                      {
                        result.veiculos.filter(
                          (v) => v.status === "DIVERGENCIA",
                        ).length
                      }
                    </span>{" "}
                    divergência
                  </span>
                  <span>
                    <span className="text-amber-400 font-semibold">
                      {
                        result.veiculos.filter((v) => v.status === "PENDENTE")
                          .length
                      }
                    </span>{" "}
                    pendente
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {result.file_base64 && (
                    <button
                      onClick={handleDownload}
                      className="text-xs px-4 py-2 rounded-lg border border-white/15 text-white/72 hover:text-white/95 hover:border-white/32 transition-colors"
                    >
                      Baixar consolidado verificado
                    </button>
                  )}
                  <button
                    onClick={handleReset}
                    className="text-xs px-4 py-2 rounded-lg border border-white/10 text-white/52 hover:text-white/80 hover:border-white/25 transition-colors"
                  >
                    Nova verificação
                  </button>
                </div>
              </div>

              {/* Tabela de veículos */}
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/3">
                      <th className="text-left px-4 py-3 text-xs text-white/58 font-medium uppercase tracking-wider">
                        Veículo
                      </th>
                      <th className="text-left px-4 py-3 text-xs text-white/58 font-medium uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 text-xs text-white/58 font-medium uppercase tracking-wider">
                        Devolutiva
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.veiculos.map((v, i) => (
                      <tr
                        key={i}
                        className={`border-b last:border-0 transition-colors ${
                          v.status === "DIVERGENCIA"
                            ? "border-rose-500/15 bg-rose-500/8 hover:bg-rose-500/12"
                            : "border-white/5 hover:bg-white/2"
                        }`}
                      >
                        <td
                          className={`px-4 py-3 font-medium ${v.status === "DIVERGENCIA" ? "text-rose-300/95" : "text-white/92"}`}
                        >
                          {v.veiculo}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md border text-xs font-semibold ${STATUS_BG[v.status]} ${STATUS_COLORS[v.status]}`}
                          >
                            {v.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <DevolutivaLines text={v.devolutiva} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Avisos */}
              {result.sem_consolidado.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-xs text-amber-400 font-semibold mb-1">
                    Comprovantes sem entrada no consolidado (
                    {result.sem_consolidado.length}):
                  </p>
                  <ul className="text-xs text-amber-300/60 space-y-0.5">
                    {result.sem_consolidado.map((n) => (
                      <li key={n}>• {n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.parse_errors.length > 0 && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
                  <p className="text-xs text-rose-400 font-semibold mb-1">
                    Erros de leitura ({result.parse_errors.length}):
                  </p>
                  <ul className="text-xs text-rose-300/60 space-y-0.5">
                    {result.parse_errors.map((e) => (
                      <li key={e.arquivo}>
                        • {e.arquivo}: {e.erro}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Anomalias de URL (IA) */}
              {result.url_check_anomalies?.length > 0 && (
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5">
                  <button
                    onClick={() => setAnomaliesOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="text-xs text-violet-400 font-semibold">
                      Anomalias de URL detectadas pela IA
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">
                        {result.url_check_anomalies.length}
                      </span>
                    </span>
                    <span className="text-white/48 text-xs">
                      {anomaliesOpen ? "▲" : "▼"}
                    </span>
                  </button>
                  {anomaliesOpen && (
                    <div className="px-4 pb-4 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/10">
                            <th className="text-left py-2 pr-4 text-white/58 font-medium">
                              URL
                            </th>
                            <th className="text-left py-2 pr-4 text-white/58 font-medium whitespace-nowrap">
                              Categoria
                            </th>
                            <th className="text-left py-2 pr-4 text-white/58 font-medium whitespace-nowrap">
                              Impressões URL
                            </th>
                            <th className="text-left py-2 pr-4 text-white/58 font-medium whitespace-nowrap">
                              % do total
                            </th>
                            <th className="text-left py-2 text-white/58 font-medium">
                              Motivo
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.url_check_anomalies.map((a, i) => (
                            <tr
                              key={i}
                              className="border-b border-white/5 last:border-0"
                            >
                              <td className="py-2 pr-4 text-white/68 max-w-[260px] truncate">
                                <a
                                  href={a.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-violet-300 transition-colors"
                                  title={a.url}
                                >
                                  {a.url}
                                </a>
                              </td>
                              <td className="py-2 pr-4 text-violet-300/70 whitespace-nowrap">
                                {a.categoria}
                              </td>
                              <td className="py-2 pr-4 text-white/72 whitespace-nowrap">
                                {formatInt(a.impressoes)}
                              </td>
                              <td className="py-2 pr-4 text-white/72 whitespace-nowrap">
                                {formatPct(a.pct)}
                              </td>
                              <td className="py-2 text-white/68">{a.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
