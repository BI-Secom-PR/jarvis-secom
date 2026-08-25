"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

// Combobox com busca para listas grandes (534 campanhas / ~2.2k anúncios) —
// um <select> nativo desse tamanho é inviável de percorrer. Substituto direto:
// value "" = nada selecionado, igual ao <option value=""> que existia antes.

// NFD-strip: usuário digita "pe de meia" e acha "Pé de Meia". Mesmo padrão de
// lib/storage.ts. Preserva o comprimento por caractere latino, então o índice do
// match na string normalizada vale para a original (usado no highlight).
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// ponytail: corte simples em vez de virtualizar; só vale mexer se 50 provar ser pouco.
const MAX_RENDER = 50;

type Props = {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  emptyLabel: string;
  className?: string;
};

export default function SearchableSelect({ value, onChange, options, emptyLabel, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return options;
    return options.filter((o) => norm(o).includes(q));
  }, [options, query]);

  // índice 0 é sempre a linha "limpar" (emptyLabel), por isso o +1 nas opções
  const rows = matches.slice(0, MAX_RENDER);
  const hidden = matches.length - rows.length;
  const lastIndex = rows.length; // 0..rows.length

  useEffect(() => setActive(0), [query, open]);

  // mantém a opção ativa visível durante a navegação por teclado
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function pick(v: string) {
    onChange(v);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); setQuery(""); return; }
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); e.preventDefault(); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, lastIndex)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(active === 0 ? "" : rows[active - 1]); }
  }

  return (
    <div
      className="relative w-full min-w-0"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setOpen(false); setQuery(""); }
      }}
    >
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        value={open ? query : value}
        placeholder={value ? undefined : emptyLabel}
        title={value || emptyLabel}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`${className} pr-8 cursor-text text-ellipsis`}
      />
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-ink-3">
        ▾
      </span>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-[300px] overflow-y-auto rounded-lg border border-separator bg-surface-opaque shadow-lg py-1"
        >
          <li
            id={`${listId}-0`}
            role="option"
            aria-selected={value === ""}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick("")}
            className={`px-3 py-2 text-[13px] cursor-pointer text-ink-3 ${active === 0 ? "bg-fill" : ""}`}
          >
            {emptyLabel}
          </li>
          {rows.map((o, i) => (
            <li
              key={o}
              id={`${listId}-${i + 1}`}
              role="option"
              aria-selected={o === value}
              title={o}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              className={`px-3 py-2 text-[13px] cursor-pointer truncate ${
                active === i + 1 ? "bg-fill text-ink" : "text-ink"
              } ${o === value ? "font-semibold" : ""}`}
            >
              <Highlight text={o} query={query} />
            </li>
          ))}
          {rows.length === 0 && (
            <li className="px-3 py-2 text-[13px] text-ink-3">Nenhum resultado</li>
          )}
          {hidden > 0 && (
            <li className="px-3 py-2 text-[11px] text-ink-3 border-t border-separator">
              … mais {hidden.toLocaleString("pt-BR")} resultados, refine a busca
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = norm(query.trim());
  const at = q ? norm(text).indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-transparent text-accent-text font-semibold">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}
