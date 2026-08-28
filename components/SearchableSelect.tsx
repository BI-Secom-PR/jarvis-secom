"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

// Combobox com busca para listas grandes (534 campanhas / ~2.2k anúncios) —
// um <select> nativo desse tamanho é inviável de percorrer. Substituto direto:
// value "" = nada selecionado, igual ao <option value=""> que existia antes.
//
// `multiple` liga o modo N valores (dashboard): value/onChange viram string[],
// clicar alterna e o dropdown fica aberto. Sem a flag o componente segue
// single-select, que é como o SentimentosContainer o usa.

// NFD-strip: usuário digita "pe de meia" e acha "Pé de Meia". Mesmo padrão de
// lib/storage.ts. Preserva o comprimento por caractere latino, então o índice do
// match na string normalizada vale para a original (usado no highlight).
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

// ponytail: corte simples em vez de virtualizar; só vale mexer se 50 provar ser pouco.
const MAX_RENDER = 50;

type Base = {
  options: string[];
  emptyLabel: string;
  className?: string;
  /** Rótulo exibido (e buscado) para um valor: plataforma → "Meta", eixo → eixo_label. */
  labelOf?: (v: string) => string;
  /** Texto no lugar de "Nenhum resultado" quando a lista chega vazia da API. */
  noOptionsHint?: string;
};

type Props = Base &
  (
    | { multiple?: false; value: string; onChange: (v: string) => void }
    | { multiple: true; value: string[]; onChange: (v: string[]) => void }
  );

export default function SearchableSelect(props: Props) {
  const { options, emptyLabel, className = "", labelOf, noOptionsHint } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const label = (v: string) => labelOf?.(v) ?? v;
  // Uma lista só para os dois modos — o single vira um array de 0 ou 1.
  const selected = Array.isArray(props.value) ? props.value : props.value ? [props.value] : [];

  const matches = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return options;
    return options.filter((o) => norm(labelOf?.(o) ?? o).includes(q));
  }, [options, query, labelOf]);

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
    if (props.multiple) {
      // "" = a linha de limpar. Fora isso alterna e mantém aberto, senão
      // escolher três plataformas seriam três reaberturas do dropdown.
      props.onChange(
        v === "" ? [] : selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]
      );
      return;
    }
    props.onChange(v);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
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
        value={open ? query : selected.map(label).join(", ")}
        placeholder={selected.length ? (open ? selected.map(label).join(", ") : undefined) : emptyLabel}
        title={selected.map(label).join(", ") || emptyLabel}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // No modo múltiplo o campo continua focado depois de Escape, e aí o onFocus
        // não dispara de novo — sem isto o segundo clique não reabre a lista.
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setQuery(""); return; }
          if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); e.preventDefault(); return; }
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, lastIndex)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(active === 0 ? "" : rows[active - 1]); }
        }}
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
          aria-multiselectable={props.multiple || undefined}
          className="absolute z-30 mt-1 w-full max-h-[300px] overflow-y-auto rounded-lg border border-separator bg-surface-opaque shadow-lg py-1"
        >
          <li
            id={`${listId}-0`}
            role="option"
            aria-selected={selected.length === 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick("")}
            className={`px-3 py-2 text-[13px] cursor-pointer text-ink-3 ${active === 0 ? "bg-fill" : ""}`}
          >
            {emptyLabel}
          </li>
          {rows.map((o, i) => {
            const on = selected.includes(o);
            return (
              <li
                key={o}
                id={`${listId}-${i + 1}`}
                role="option"
                aria-selected={on}
                title={label(o)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
                className={`px-3 py-2 text-[13px] cursor-pointer truncate ${
                  active === i + 1 ? "bg-fill text-ink" : "text-ink"
                } ${on ? "font-semibold" : ""}`}
              >
                {props.multiple && (
                  <span aria-hidden className={`mr-2 ${on ? "text-accent-text" : "text-ink-4"}`}>
                    {on ? "✓" : "·"}
                  </span>
                )}
                <Highlight text={label(o)} query={query} />
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="px-3 py-2 text-[13px] text-ink-3">
              {options.length === 0 && noOptionsHint ? noOptionsHint : "Nenhum resultado"}
            </li>
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
