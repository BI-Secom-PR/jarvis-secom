const SEP = ';'
const BOM = '﻿'

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (v instanceof Date) {
    s = v.toLocaleDateString('pt-BR')
  } else if (typeof v === 'number') {
    s = Number.isInteger(v)
      ? v.toLocaleString('pt-BR')
      : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } else if (typeof v === 'object') {
    s = JSON.stringify(v)
  } else {
    s = String(v)
  }
  if (s.includes(SEP) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function generateCsv(rows: Record<string, unknown>[]): Buffer {
  if (rows.length === 0) return Buffer.from(BOM + 'sem resultados\r\n', 'utf8')
  const cols = Object.keys(rows[0])
  const lines: string[] = []
  lines.push(cols.map(cell).join(SEP))
  for (const row of rows) {
    lines.push(cols.map((c) => cell(row[c])).join(SEP))
  }
  return Buffer.from(BOM + lines.join('\r\n') + '\r\n', 'utf8')
}
