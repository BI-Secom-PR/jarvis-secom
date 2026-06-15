"use client";

import { Fragment, useState, useEffect } from "react";
import Link from "next/link";
import JarvisRing from "./JarvisRing";

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
  categoria_sugerida?: string | null;
  veiculo: string;
  reason: string;
  impressoes?: number;
  pct?: number;
};

type VerificationResult = {
  veiculos: VehicleResult[];
  sem_comprovante: string[];
  sem_consolidado: string[];
  sem_consolidado_verif: string[];
  sem_consolidado_comp: string[];
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
  OK: "text-success",
  DIVERGENCIA: "text-danger",
  PENDENTE: "text-warning",
};

const STATUS_BG: Record<string, string> = {
  OK: "bg-success/10 border-success/25",
  DIVERGENCIA: "bg-danger/10 border-danger/25",
  PENDENTE: "bg-warning/10 border-warning/25",
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
            ? "border border-accent bg-accent-soft"
            : hasFiles
              ? "border border-accent-border bg-fill hover:border-accent"
              : "border border-dashed border-separator-strong bg-fill hover:bg-fill-2"
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
      <div className={`px-4 pt-3 pb-2 border-b ${hasFiles ? "border-separator" : "border-transparent"}`}>
        <p className="text-[10px] text-ink-3 font-semibold uppercase tracking-widest">
          {label}
        </p>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        {!hasFiles ? (
          <div className="flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0 text-ink-4">
              <path d="M9 11.5V4M6 6.5 9 3.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 12.5v1A1.5 1.5 0 0 0 4.5 15h9a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <p className="text-sm text-ink-3">
              {multiple ? "Arraste arquivos" : "Arraste o arquivo"}{" "}
              <span className="text-ink-2">ou clique</span>
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {files.map((f, i) => (
              <li
                key={`${i}-${f.name}`}
                className="flex items-center gap-2"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-accent-text">
                  <path d="M7 1H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4L7 1Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                  <path d="M7 1v3h3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                </svg>
                <span className="text-sm text-ink truncate">{f.name}</span>
                <span className="text-[10px] text-ink-3 ml-auto shrink-0 tabular-nums">
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
const DEVOLUTIVA_LINE_RE = /^(OK|DIV|DIF|ALERTA|\?)\s+([^:]+):(.*)$/;

function difColorByPct(pctValue: number | null): string {
  if (typeof pctValue !== "number" || !Number.isFinite(pctValue)) {
    return "text-warning/80";
  }
  const absPct = Math.abs(pctValue);
  if (absPct === 0) return "text-(--dif-ok)";
  if (absPct <= 5) return "text-(--dif-warn)";
  return "text-(--dif-bad)";
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
          const isAlerta = prefix === "ALERTA";
          const pctMatch = rest.match(/\(([+-]?\d+(?:[.,]\d+)?)%\)/);
          const pctValue = pctMatch
            ? Number.parseFloat(pctMatch[1].replace(",", "."))
            : null;
          const color = isOk
            ? "text-success"
            : isDiv
              ? "text-danger"
              : isDif
                ? difColorByPct(pctValue)
                : isAlerta
                  ? "text-warning"
                  : "text-warning/80";
          return (
            <div key={i} className="text-xs leading-relaxed">
              <span className={`font-bold ${color}`}>{prefix}</span>{" "}
              <span className={`font-semibold ${color}`}>{campo.trim()}:</span>
              <span className="text-ink-2">{rest}</span>
            </div>
          );
        }
        // Linhas sem prefixo (PENDENTE, OK —, etc.)
        const isPendente = line.startsWith("PENDENTE");
        return (
          <div
            key={i}
            className={`text-xs leading-relaxed ${
              isPendente ? "text-warning font-medium" : "text-ink-2 italic"
            }`}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
}

const ESTADOS_BRASIL = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

const ADSERVERS: { id: string; label: string; disabled?: boolean }[] = [
  { id: "00px", label: "00px" },
  { id: "adforce", label: "ADFORCE" },
  { id: "admotion", label: "ADMOTION" },
  { id: "ahead", label: "AHEAD" },
  { id: "metrike", label: "METRIKE" },
  { id: "sense", label: "SENSE" },
  { id: "brz", label: "BRZ", disabled: true },
];

function formatElapsed(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

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
  const [praca, setPraca] = useState<string>("");
  const [viewRules, setViewRules] = useState<ViewRule[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [anomaliesOpen, setAnomaliesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
      setElapsedSeconds(0);
      setProgressPct(0);
      setProgressLabel('');
      return;
    }
    const id = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  async function handleVerificar() {
    if (!adserver || !consolidado[0] || comprovantes.length === 0) return;
    setLoading(true);
    setProgressPct(0);
    setProgressLabel('');
    setUploadProgress(null);
    setError(null);
    setResult(null);

    const consumeVerifStream = async (res: Response) => {
      if (!res.ok && res.status !== 200) {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = (JSON.parse(text) as { error?: string }).error ?? text; } catch { msg = text || msg; }
        throw new Error(msg);
      }
      if (!res.body) throw new Error(`HTTP ${res.status}: servidor não retornou stream`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'engine_start')           { setProgressPct(10); setProgressLabel('Processando arquivos...'); }
          else if (ev.type === 'engine_done')        { setProgressPct(45); setProgressLabel('Cruzando veículos com o consolidado...'); }
          else if (ev.type === 'url_check_start')    { setProgressLabel(`Verificando URLs com IA... (0/${ev.total})`); }
          else if (ev.type === 'url_check_progress') {
            setProgressPct(45 + Math.round((ev.done / ev.total) * 43));
            setProgressLabel(`Verificando URLs com IA... (${ev.done}/${ev.total})`);
          }
          else if (ev.type === 'writing')            { setProgressPct(92); setProgressLabel('Gerando arquivo verificado...'); }
          else if (ev.type === 'done')               { setProgressPct(100); setResult(ev.result); break outer; }
          else if (ev.type === 'error')              { throw new Error(ev.message); }
        }
      }
    };

    try {
      if (process.env.NEXT_PUBLIC_USE_BLOB_UPLOAD) {
        // Upload files to Vercel Blob via server-side API route
        const allFiles = [consolidado[0], ...comprovantes, ...verifs];
        setUploadProgress({ done: 0, total: allFiles.length });

        const blobUpload = async (file: File) => {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/verification/blob-upload", { method: "POST", body: fd });
          const text = await res.text();
          if (!res.ok) throw new Error(`Upload failed: ${text}`);
          let json: { url?: string };
          try { json = JSON.parse(text); } catch { throw new Error(`Unexpected response from blob upload`); }
          if (!json.url) throw new Error(`Blob upload returned no URL`);
          setUploadProgress((p) => p && { ...p, done: p.done + 1 });
          return json.url;
        };

        const consolidadoUrl = await blobUpload(consolidado[0]);
        const compUrls: string[] = [];
        for (const f of comprovantes) compUrls.push(await blobUpload(f));
        const verifUrls: string[] = [];
        for (const f of verifs) verifUrls.push(await blobUpload(f));
        setUploadProgress(null);
        setProgressPct(8);
        setProgressLabel('Aguardando processamento...');

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
            ...(praca ? { praca } : {}),
          }),
        });
        await consumeVerifStream(res);
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
        if (praca) form.append("praca", praca);

        const res = await fetch("/api/verification/run", {
          method: "POST",
          body: form,
        });
        await consumeVerifStream(res);
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
    setPraca("");
    setViewRules([]);
    setResult(null);
    setError(null);
  }

  const canSubmit =
    !!adserver && consolidado.length > 0 && comprovantes.length > 0 && !loading;

  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden relative nebula-bg">
      {/* Header — breadcrumb left, ring right (never overlapping on phones) */}
      <header className="shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 pb-3 md:pb-4 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-4 border-b border-separator">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            href="/"
            className="text-xs text-ink-3 hover:text-ink transition-colors py-3 -my-3 shrink-0"
          >
            Início
          </Link>
          <span className="text-ink-4 text-xs shrink-0">›</span>
          <h1 className="text-xs font-semibold text-ink tracking-wide truncate">
            Verificação de Consolidados
          </h1>
        </div>
        <div className="shrink-0">
          <JarvisRing size={34} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-5 md:px-6 md:py-8 space-y-6">
          {/* Seletor de Adserver */}
          <div className="space-y-2">
            <span className="text-xs text-ink-2 font-medium uppercase tracking-wider">
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
                  className={`px-3.5 py-2.5 md:px-3 md:py-1.5 rounded-lg text-[13px] md:text-xs font-semibold transition-colors border ${
                    a.disabled
                      ? "border-separator text-ink-4 cursor-not-allowed"
                      : adserver === a.id
                        ? "bg-accent-soft border-accent-border text-accent-text"
                        : "bg-fill border-separator text-ink-2 hover:text-ink hover:border-separator-strong"
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
            <span className="text-xs text-ink-2 font-medium uppercase tracking-wider shrink-0">
              % URLs analisadas por IA
            </span>
            <div className="flex items-center gap-1">
              <button
                id="decreaseButton"
                type="button"
                onClick={() => setUrlSamplePct((v) => Math.max(0, v - 5))}
                className="w-11 h-11 md:w-7 md:h-7 flex items-center justify-center rounded-lg md:rounded-md bg-fill border border-separator text-ink-2 hover:bg-fill-2 hover:text-ink hover:border-separator-strong active:bg-fill-2 transition-all disabled:opacity-30"
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
                className="w-16 md:w-14 bg-fill border border-separator rounded-md py-2 md:py-1 text-[16px] md:text-sm text-ink text-center focus:outline-none focus:border-accent-border [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                id="increaseButton"
                type="button"
                onClick={() => setUrlSamplePct((v) => Math.min(100, v + 5))}
                className="w-11 h-11 md:w-7 md:h-7 flex items-center justify-center rounded-lg md:rounded-md bg-fill border border-separator text-ink-2 hover:bg-fill-2 hover:text-ink hover:border-separator-strong active:bg-fill-2 transition-all disabled:opacity-30"
                disabled={urlSamplePct === 100}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                  <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                </svg>
              </button>
            </div>
            <span className="text-xs text-ink-3">
              {urlSamplePct === 0 ? "todas as URLs · só > 100 imp · máx 1000" : `${urlSamplePct}% por categoria · só > 100 imp · máx 1000`}
            </span>
          </div>
          {/* Filtro de Praça */}
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs text-ink-2 font-medium uppercase tracking-wider shrink-0">
              Praça
            </span>
            <select
              value={praca}
              onChange={(e) => setPraca(e.target.value)}
              className="bg-fill border border-separator rounded-lg px-3 py-2.5 md:py-1.5 text-[16px] md:text-sm text-ink focus:outline-none focus:border-accent-border appearance-none cursor-pointer"
            >
              <option value="">Todos os estados</option>
              {ESTADOS_BRASIL.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
            {praca && (
              <span className="text-xs text-ink-3">
                filtrando verification por <span className="text-accent-text font-semibold">{praca}</span>
              </span>
            )}
          </div>

          {/* Regras de Visualização */}
          <div className="space-y-2">
            <button
              onClick={() => setRulesOpen((o) => !o)}
              className="flex items-center gap-2 text-xs text-ink-2 hover:text-ink transition-colors font-medium uppercase tracking-wider py-2 -my-2"
            >
              <span>{rulesOpen ? "▾" : "▸"}</span>
              Regras de Visualização
              {viewRules.length > 0 && (
                <span className="bg-accent-soft text-accent-text rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
                  {viewRules.length}
                </span>
              )}
            </button>
            {rulesOpen && (
              <div className="space-y-2 pl-4 border-l border-separator">
                {viewRules.map((rule, idx) => (
                  <div key={idx} className="flex flex-col items-stretch sm:flex-row sm:items-center gap-2 sm:flex-wrap">
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
                      className="bg-fill border border-separator rounded-lg px-3 py-2.5 md:py-1.5 text-[16px] md:text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent-border w-full sm:w-40"
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
                      className="bg-fill border border-separator rounded-lg px-3 py-2.5 md:py-1.5 text-[16px] md:text-sm text-ink focus:outline-none focus:border-accent-border appearance-none cursor-pointer"
                    >
                      {CRITERIO_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
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
                      className="bg-fill border border-separator rounded-lg px-3 py-2.5 md:py-1.5 text-[16px] md:text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent-border w-full sm:w-32"
                    />
                    <button
                      onClick={() =>
                        setViewRules((rs) => rs.filter((_, i) => i !== idx))
                      }
                      className="text-ink-3 hover:text-danger transition-colors text-base md:text-sm px-3 py-2 md:px-1 md:py-0 self-end sm:self-auto"
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
                  className="text-xs text-accent-text hover:opacity-80 transition-colors py-2 -my-1"
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
              <span className="text-xs text-ink-2 font-medium uppercase tracking-wider shrink-0 mr-1">
                Ano
              </span>
              {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                <button
                  key={y}
                  onClick={() => selectYear(y)}
                  className={`px-3 py-2 md:px-2.5 md:py-1 rounded-md text-[13px] md:text-xs font-medium transition-colors border ${
                    selectedYear === y
                      ? "bg-accent-soft border-accent-border text-accent-text"
                      : "bg-fill border-separator text-ink-2 hover:text-ink hover:border-separator-strong"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
            {/* Chips de mês */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-ink-2 font-medium uppercase tracking-wider shrink-0 mr-1">
                Mês
              </span>
              {MONTHS.map((m) => (
                <button
                  key={m.num}
                  onClick={() => selectMonth(m.num)}
                  className={`px-3 py-2 md:px-2.5 md:py-1 rounded-md text-[13px] md:text-xs font-medium transition-colors border ${
                    selectedMonth === m.num
                      ? "bg-accent-soft border-accent-border text-accent-text"
                      : "bg-fill border-separator text-ink-2 hover:text-ink hover:border-separator-strong"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {/* Range manual */}
            <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2 sm:gap-3 max-w-md">
              <span className="text-xs text-ink-3 shrink-0">ou</span>
              <input
                type="text"
                placeholder="DD/MM/AAAA"
                value={ini}
                onChange={(e) => handleManualDate("ini", e.target.value)}
                className="bg-fill border border-separator rounded-lg px-3 py-2.5 md:py-2 text-[16px] md:text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent-border w-full min-w-0"
              />
              <span className="text-ink-3 text-sm">até</span>
              <input
                type="text"
                placeholder="DD/MM/AAAA"
                value={fim}
                onChange={(e) => handleManualDate("fim", e.target.value)}
                className="bg-fill border border-separator rounded-lg px-3 py-2.5 md:py-2 text-[16px] md:text-sm text-ink placeholder:text-ink-4 focus:outline-none focus:border-accent-border w-full min-w-0"
              />
            </div>
          </div>

          {/* Botão */}
          <button
            onClick={handleVerificar}
            disabled={!canSubmit}
            className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all duration-200
              bg-accent text-accent-ink hover:opacity-90 active:opacity-80
              hover:shadow-[0_0_24px_rgba(10,132,255,0.25)]
              disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:shadow-none"
          >
            Verificar
          </button>

          {/* Animação de carregamento */}
          {loading && (
            <div className="flex flex-col items-center gap-5 py-6">
              {/* Spinner */}
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-2 border-separator" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" />
                <div className="absolute inset-[6px] rounded-full border border-transparent border-t-accent/40 animate-spin [animation-duration:1.5s]" />
              </div>
              {/* Etapa atual */}
              <div className="flex flex-col items-center gap-1.5 w-full max-w-xs">
                <p className="text-sm text-accent-text font-medium animate-pulse text-center">
                  {uploadProgress
                    ? `Enviando arquivos... ${uploadProgress.done}/${uploadProgress.total}`
                    : progressLabel || 'Preparando...'}
                </p>
                <p className="text-xs text-ink-3">
                  Isso pode levar alguns minutos...
                </p>
              </div>
              {/* Barra de progresso */}
              <div className="w-full max-w-xs">
                <div className="w-full bg-fill-2 rounded-full h-1.5">
                  <div
                    className="bg-accent h-1.5 rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${uploadProgress ? Math.round((uploadProgress.done / uploadProgress.total) * 8) : progressPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-ink-4 mt-1.5">
                  <span>{uploadProgress ? `${Math.round((uploadProgress.done / uploadProgress.total) * 8)}%` : `${progressPct}%`}</span>
                  <span>{formatElapsed(elapsedSeconds)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="rounded-xl border border-danger/25 bg-danger/10 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-danger font-medium">Erro</p>
                  <p className="text-xs text-danger/80 mt-1 whitespace-pre-wrap">
                    {error}
                  </p>
                </div>
                <button
                  onClick={handleReset}
                  className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-danger/25 text-danger/70 hover:text-danger hover:border-danger/40 transition-colors"
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-4 text-xs text-ink-2">
                  <span>
                    <span className="text-success font-semibold">
                      {result.veiculos.filter((v) => v.status === "OK").length}
                    </span>{" "}
                    OK
                  </span>
                  <span>
                    <span className="text-danger font-semibold">
                      {
                        result.veiculos.filter(
                          (v) => v.status === "DIVERGENCIA",
                        ).length
                      }
                    </span>{" "}
                    divergência
                  </span>
                  <span>
                    <span className="text-warning font-semibold">
                      {
                        result.veiculos.filter((v) => v.status === "PENDENTE")
                          .length
                      }
                    </span>{" "}
                    pendente
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  {result.file_base64 && (
                    <button
                      onClick={handleDownload}
                      className="text-xs px-4 py-2.5 sm:py-2 rounded-lg border border-separator text-ink-2 hover:text-ink hover:border-separator-strong transition-colors"
                    >
                      Baixar consolidado verificado
                    </button>
                  )}
                  <button
                    onClick={handleReset}
                    className="text-xs px-4 py-2 rounded-lg border border-separator text-ink-3 hover:text-ink hover:border-separator-strong transition-colors"
                  >
                    Nova verificação
                  </button>
                </div>
              </div>

              {/* Tabela de veículos */}
              <div className="rounded-xl border border-separator overflow-hidden">
                <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-separator bg-fill">
                      <th className="text-left px-4 py-3 text-xs text-ink-2 font-medium uppercase tracking-wider">
                        Veículo
                      </th>
                      <th className="text-left px-4 py-3 text-xs text-ink-2 font-medium uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 text-xs text-ink-2 font-medium uppercase tracking-wider">
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
                            ? "border-danger/20 bg-danger/10 hover:bg-danger/15"
                            : "border-separator hover:bg-fill"
                        }`}
                      >
                        <td
                          className={`px-4 py-3 font-medium ${v.status === "DIVERGENCIA" ? "text-danger" : "text-ink"}`}
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
                        <td className="px-4 py-3 min-w-[260px]">
                          <DevolutivaLines text={v.devolutiva} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>

              {/* Avisos */}
              {result.sem_consolidado_verif?.length > 0 && (
                <div className="rounded-xl border border-warning/25 bg-warning/5 p-4">
                  <p className="text-xs text-warning font-semibold mb-1">
                    Verification sem entrada no consolidado (
                    {result.sem_consolidado_verif.length}):
                  </p>
                  <ul className="text-xs text-warning/80 space-y-0.5">
                    {result.sem_consolidado_verif.map((n) => (
                      <li key={n}>• {n}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.sem_consolidado_comp?.length > 0 && (
                <div className="rounded-xl border border-warning/25 bg-warning/5 p-4">
                  <p className="text-xs text-warning font-semibold mb-1">
                    Comprovantes sem entrada no consolidado (
                    {result.sem_consolidado_comp.length}):
                  </p>
                  <ul className="text-xs text-warning/80 space-y-0.5">
                    {result.sem_consolidado_comp.map((n) => (
                      <li key={n}>• {n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.parse_errors.length > 0 && (
                <div className="rounded-xl border border-danger/25 bg-danger/5 p-4">
                  <p className="text-xs text-danger font-semibold mb-1">
                    Erros de leitura ({result.parse_errors.length}):
                  </p>
                  <ul className="text-xs text-danger/80 space-y-0.5">
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
                    <span className="text-xs text-(--ai) font-semibold">
                      Anomalias de URL detectadas pela IA
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-violet-500/20 text-(--ai)">
                        {result.url_check_anomalies.length}
                      </span>
                    </span>
                    <span className="text-ink-3 text-xs">
                      {anomaliesOpen ? "▲" : "▼"}
                    </span>
                  </button>
                  {anomaliesOpen && (
                    <div className="px-4 pb-4 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-separator">
                            <th className="text-left py-2 pr-4 text-ink-2 font-medium">
                              URL
                            </th>
                            <th className="text-left py-2 pr-4 text-ink-2 font-medium whitespace-nowrap">
                              Categoria
                            </th>
                            <th className="text-left py-2 pr-4 text-ink-2 font-medium whitespace-nowrap">
                              Categoria sugerida
                            </th>
                            <th className="text-left py-2 pr-4 text-ink-2 font-medium whitespace-nowrap">
                              Impressões URL
                            </th>
                            <th className="text-left py-2 pr-4 text-ink-2 font-medium whitespace-nowrap">
                              % do total
                            </th>
                            <th className="text-left py-2 text-ink-2 font-medium">
                              Motivo
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(
                            result.url_check_anomalies.reduce<Record<string, UrlAnomaly[]>>(
                              (acc, a) => {
                                const v = a.veiculo || "—";
                                (acc[v] ??= []).push(a);
                                return acc;
                              },
                              {}
                            )
                          ).map(([veiculo, anomalias]) => (
                            <Fragment key={veiculo}>
                              <tr className="border-b border-separator">
                                <td
                                  colSpan={6}
                                  className="pt-3 pb-1 text-(--ai) font-semibold"
                                >
                                  {veiculo}
                                  <span className="ml-2 text-ink-3 font-normal">
                                    {anomalias.length} URL{anomalias.length > 1 ? "s" : ""}
                                  </span>
                                </td>
                              </tr>
                              {anomalias.map((a, i) => (
                                <tr
                                  key={i}
                                  className="border-b border-separator last:border-0"
                                >
                                  <td className="py-2 pr-4 text-ink-2 max-w-[260px] truncate">
                                    <a
                                      href={a.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="hover:text-(--ai) transition-colors"
                                      title={a.url}
                                    >
                                      {a.url}
                                    </a>
                                  </td>
                                  <td className="py-2 pr-4 text-(--ai)/80 whitespace-nowrap">
                                    {a.categoria}
                                  </td>
                                  <td className="py-2 pr-4 text-warning/90 whitespace-nowrap">
                                    {a.categoria_sugerida ?? "—"}
                                  </td>
                                  <td className="py-2 pr-4 text-ink-2 whitespace-nowrap">
                                    {formatInt(a.impressoes)}
                                  </td>
                                  <td className="py-2 pr-4 text-ink-2 whitespace-nowrap">
                                    {formatPct(a.pct)}
                                  </td>
                                  <td className="py-2 text-ink-2">{a.reason}</td>
                                </tr>
                              ))}
                            </Fragment>
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
