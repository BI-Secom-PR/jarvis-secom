"use client";

import { useState } from "react";
import Link from "next/link";

type VehicleResult = {
  veiculo: string;
  status: "OK" | "DIVERGENCIA" | "PENDENTE";
  devolutiva: string;
  match: string | null;
  score: number;
  formato?: string;
};

type VerificationResult = {
  veiculos: VehicleResult[];
  sem_comprovante: string[];
  sem_consolidado: string[];
  parse_errors: { arquivo: string; erro: string }[];
  file_base64: string | null;
  file_name: string;
};

const STATUS_COLORS: Record<string, string> = {
  OK:          "text-emerald-400",
  DIVERGENCIA: "text-rose-400",
  PENDENTE:    "text-amber-400",
};

const STATUS_BG: Record<string, string> = {
  OK:          "bg-emerald-500/10 border-emerald-500/20",
  DIVERGENCIA: "bg-rose-500/10 border-rose-500/20",
  PENDENTE:    "bg-amber-500/10 border-amber-500/20",
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

  return (
    <div
      className={`relative border border-dashed rounded-xl p-4 transition-colors select-none
        ${dragging
          ? "border-white/50 bg-white/[0.06]"
          : "border-white/20 bg-white/[0.02] hover:border-white/40 hover:bg-white/[0.04]"
        }`}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
      onDragOver={(e)  => { e.preventDefault(); e.stopPropagation(); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
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
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
        onDragOver={(e)  => { e.preventDefault(); e.stopPropagation(); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      />
      <p className="text-xs text-white/40 mb-2 font-medium uppercase tracking-wider">
        {label}
      </p>
      {files.length === 0 ? (
        <p className="text-sm text-white/30">
          Clique ou arraste {multiple ? "arquivos" : "o arquivo"} .xlsx aqui
        </p>
      ) : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.name} className="text-sm text-white/70 flex items-center gap-2">
              <span className="text-white/30">•</span>
              <span className="truncate max-w-[320px]">{f.name}</span>
              <span className="text-white/30 text-xs ml-auto shrink-0">
                {(f.size / 1024).toFixed(0)} KB
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function VerificationContainer() {
  const [consolidado, setConsolidado] = useState<File[]>([]);
  const [outros, setOutros] = useState<File[]>([]);
  const [ini, setIni] = useState("");
  const [fim, setFim] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleVerificar() {
    if (!consolidado[0] || outros.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("consolidado", consolidado[0]);
      for (const f of outros) form.append("files", f);
      if (ini) form.append("ini", ini);
      if (fim) form.append("fim", fim);

      const res = await fetch("/api/verification/run", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
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

  const canSubmit = consolidado.length > 0 && outros.length > 0 && !loading;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden relative nebula-bg">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            ← Início
          </Link>
          <span className="text-white/20">|</span>
          <h1 className="text-sm font-semibold text-white/80 tracking-wide">
            Verificação de Consolidados
          </h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
          {/* Inputs */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FileDrop
              label="Consolidado"
              accept=".xlsx"
              multiple={false}
              onChange={setConsolidado}
              files={consolidado}
            />
            <FileDrop
              label="Comprovantes + Arquivos Verification"
              accept=".xlsx"
              multiple={true}
              onChange={setOutros}
              files={outros}
            />
          </div>

          {/* Filtro de data (opcional) */}
          <div className="flex items-center gap-4">
            <span className="text-xs text-white/40 font-medium uppercase tracking-wider shrink-0">
              Período (opcional)
            </span>
            <input
              type="text"
              placeholder="DD/MM/AAAA"
              value={ini}
              onChange={(e) => setIni(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 placeholder:text-white/25 focus:outline-none focus:border-white/30 w-36"
            />
            <span className="text-white/30 text-sm">até</span>
            <input
              type="text"
              placeholder="DD/MM/AAAA"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/70 placeholder:text-white/25 focus:outline-none focus:border-white/30 w-36"
            />
          </div>

          {/* Botão */}
          <button
            onClick={handleVerificar}
            disabled={!canSubmit}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all
              bg-[rgba(120,180,255,0.12)] hover:bg-[rgba(120,180,255,0.2)]
              border border-[rgba(120,180,255,0.2)] hover:border-[rgba(120,180,255,0.4)]
              text-[rgba(120,180,255,0.9)] hover:text-[rgba(120,180,255,1)]
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Verificando..." : "Verificar"}
          </button>

          {/* Erro */}
          {error && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4">
              <p className="text-sm text-rose-400 font-medium">Erro</p>
              <p className="text-xs text-rose-300/70 mt-1 whitespace-pre-wrap">{error}</p>
            </div>
          )}

          {/* Resultados */}
          {result && (
            <div className="space-y-4">
              {/* Resumo */}
              <div className="flex items-center justify-between">
                <div className="flex gap-4 text-xs text-white/50">
                  <span>
                    <span className="text-emerald-400 font-semibold">
                      {result.veiculos.filter((v) => v.status === "OK").length}
                    </span>{" "}
                    OK
                  </span>
                  <span>
                    <span className="text-rose-400 font-semibold">
                      {result.veiculos.filter((v) => v.status === "DIVERGENCIA").length}
                    </span>{" "}
                    divergência
                  </span>
                  <span>
                    <span className="text-amber-400 font-semibold">
                      {result.veiculos.filter((v) => v.status === "PENDENTE").length}
                    </span>{" "}
                    pendente
                  </span>
                </div>
                {result.file_base64 && (
                  <button
                    onClick={handleDownload}
                    className="text-xs px-4 py-2 rounded-lg border border-white/15 text-white/60 hover:text-white/90 hover:border-white/30 transition-colors"
                  >
                    Baixar consolidado verificado
                  </button>
                )}
              </div>

              {/* Tabela de veículos */}
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.03]">
                      <th className="text-left px-4 py-3 text-xs text-white/40 font-medium uppercase tracking-wider">
                        Veículo
                      </th>
                      <th className="text-left px-4 py-3 text-xs text-white/40 font-medium uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 text-xs text-white/40 font-medium uppercase tracking-wider">
                        Devolutiva
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.veiculos.map((v, i) => (
                      <tr
                        key={i}
                        className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-4 py-3 text-white/80 font-medium">{v.veiculo}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md border text-xs font-semibold ${STATUS_BG[v.status]} ${STATUS_COLORS[v.status]}`}
                          >
                            {v.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white/50 text-xs whitespace-pre-wrap">
                          {v.devolutiva}
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
                    Comprovantes sem entrada no consolidado ({result.sem_consolidado.length}):
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
