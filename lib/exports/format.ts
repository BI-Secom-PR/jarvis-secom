// ─── Smart cell formatter ───────────────────────────────────────────────────
// MySQL returns decimals as strings ("0.039113..."), so we parse both number
// and numeric-string values before applying formatting logic.
export function fmtCell(v: unknown, colName = ''): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toLocaleDateString('pt-BR')

  let num: number | null = null
  if (typeof v === 'number') {
    num = v
  } else if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) {
    num = Number(v)
  }

  if (num !== null) {
    const col = colName.toLowerCase()

    if (/cpv|cpc|cpm|investimento|investment|custo|cost/.test(col)) {
      if (num >= 1_000_000) return `R$ ${(num / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} Mi`
      if (num >= 1_000)     return `R$ ${(num / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} K`
      return `R$ ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }

    if (/vtr|ctr|taxa|rate|percent/.test(col)) {
      return `${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    }

    if (num >= 1_000_000) return `${(num / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} Mi`
    if (num >= 1_000)     return `${(num / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} K`
    if (num !== Math.floor(num)) return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    return num.toLocaleString('pt-BR')
  }

  return String(v)
}
