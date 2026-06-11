import { createHash } from 'node:crypto'
import { renderChartSvg } from './chart-svg'
import { fmtCell } from './format'
import type { ChartSpec } from './types'

interface HtmlInput {
  rows: Record<string, unknown>[]
  title?: string
  chart?: ChartSpec
  report_text?: string
}

// ─── Print button script ─────────────────────────────────────────────────────
// Kept as a single static constant so the CSP sha256 hash (printScriptHash)
// always matches the script actually embedded in the document.
export const PRINT_SCRIPT =
  "document.getElementById('print-btn').addEventListener('click',function(){window.print()})"

export function printScriptHash(): string {
  return createHash('sha256').update(PRINT_SCRIPT, 'utf8').digest('base64')
}

// ─── Escaping ────────────────────────────────────────────────────────────────
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Escape first, then promote **bold** — markers survive escaping untouched.
function inlineBold(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

// ─── Document scaffold ───────────────────────────────────────────────────────
const STYLES = `
  @page { size: A4; margin: 14mm 12mm 18mm; }
  :root { --dark:#1e293b; --metrics:#f59e0b; --platform:#1e3a5f; --alt:#f1f5f9; --muted:#64748b; }
  * { box-sizing: border-box; }
  body { font: 10pt/1.45 Helvetica, Arial, sans-serif; color: var(--dark);
         max-width: 186mm; margin: 0 auto; padding: 24px 16px; background: #fff; }
  h1 { font-size: 17pt; margin: 0 0 2px; }
  h3 { font-size: 11pt; margin: 12px 0 6px; }
  p { margin: 5px 0; font-size: 9.5pt; }
  .gen { font-size: 8.5pt; color: var(--muted); margin: 0 0 14px; }
  .metrics { display: flex; background: var(--metrics); padding: 10px 4px; margin: 8px 0;
             break-inside: avoid; }
  .metrics .cell { flex: 1; text-align: center; padding: 0 4px; }
  .metrics .value { font-size: 15pt; font-weight: 700; }
  .metrics .label { font-size: 7.5pt; }
  .platforms { background: var(--platform); color: #fff; font-size: 9pt;
               padding: 10px 12px; margin: 8px 0; break-inside: avoid; }
  h2 { background: var(--dark); color: #fff; font-size: 11pt; font-weight: 700;
       text-transform: uppercase; text-align: center; padding: 6px 0;
       margin: 16px 0 10px; break-after: avoid; }
  ul { padding-left: 18px; margin: 6px 0; }
  li { margin-bottom: 5px; font-size: 9.5pt; }
  .chart { margin: 8px 0 16px; break-inside: avoid; }
  .chart svg, .chart img { width: 100%; height: auto; display: block; }
  table.data { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  table.data.wide { font-size: 7.5pt; }
  table.data.xwide { font-size: 7pt; }
  .data thead { display: table-header-group; }
  .data thead th { background: var(--dark); color: #fff; padding: 5px 4px; text-align: left; }
  .data tbody td { padding: 4px; }
  .data tbody tr:nth-child(odd) { background: var(--alt); }
  .data tr { break-inside: avoid; }
  #layout { width: 100%; border-collapse: collapse; }
  #layout > tbody > tr > td, #layout > tfoot > tr > td { padding: 0; }
  .footer-space { height: 0; }
  .empty { font-style: italic; color: var(--muted); font-size: 11pt; }
  footer { background: var(--dark); color: #fff; font-size: 9pt; font-weight: 700;
           text-align: center; padding: 6px 0; margin-top: 24px; }
  #print-btn { position: fixed; right: 20px; bottom: 20px; padding: 10px 18px;
               background: var(--dark); color: #fff; border: 0; border-radius: 8px;
               font-size: 10pt; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
  #print-btn:hover { background: #334155; }
  @media print {
    body { padding: 0; max-width: none; }
    #print-btn { display: none; }
    /* Repeat the footer on every page; the tfoot spacer reserves matching
       room at the bottom of each page so content never slides under it. */
    footer { position: fixed; bottom: 0; left: 0; right: 0; margin: 0; }
    .footer-space { height: 34px; }
  }
`

export function wrapPrintableHtml({ title, bodyHtml }: { title?: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || 'Jarvis Export')}</title>
<style>${STYLES}</style>
</head>
<body>
<table id="layout">
<tfoot><tr><td><div class="footer-space"></div></td></tr></tfoot>
<tbody><tr><td>
${bodyHtml}
</td></tr></tbody>
</table>
<footer>Núcleo de BI &nbsp;|&nbsp; NM Secom &nbsp;|&nbsp; SPP</footer>
<button id="print-btn">Imprimir / Salvar PDF</button>
<script>${PRINT_SCRIPT}</script>
</body>
</html>`
}

// ─── Metrics bar ─────────────────────────────────────────────────────────────
function renderMetricsBar(line: string): string {
  const raw = line.replace(/^\[METRICS\]\s*/i, '').trim()
  const items = raw.split('|').map((s) => s.trim()).filter(Boolean)
  if (!items.length) return ''

  const cells = items.map((item) => {
    const colon = item.indexOf(':')
    const label = colon >= 0 ? item.slice(0, colon).trim() : item
    const value = colon >= 0 ? item.slice(colon + 1).trim() : ''
    return `<div class="cell"><div class="value">${escapeHtml(value)}</div><div class="label">${escapeHtml(label)}</div></div>`
  })
  return `<div class="metrics">${cells.join('')}</div>`
}

// ─── Platforms box ───────────────────────────────────────────────────────────
function renderPlatformsBox(line: string): string {
  const text = line.replace(/^\[PLATFORMS\]\s*/i, '').trim()
  if (!text) return ''
  return `<div class="platforms"><strong>Plataformas:</strong>&nbsp; ${escapeHtml(text)}</div>`
}

// ─── Markdown dispatcher ─────────────────────────────────────────────────────
function renderMarkdownContent(content: string): string {
  const out: string[] = []
  let listOpen = false
  const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false } }

  for (const line of content.split('\n')) {
    const t = line.trim()

    if (!t) { closeList(); continue }

    if (/^\[METRICS\]/i.test(t)) { closeList(); out.push(renderMetricsBar(t)); continue }
    if (/^\[PLATFORMS\]/i.test(t)) { closeList(); out.push(renderPlatformsBox(t)); continue }

    if (t.startsWith('## ')) { closeList(); out.push(`<h2>${escapeHtml(t.slice(3))}</h2>`); continue }
    if (t.startsWith('### ')) { closeList(); out.push(`<h3>${inlineBold(t.slice(4))}</h3>`); continue }
    if (t.startsWith('# ')) { closeList(); out.push(`<h1>${inlineBold(t.slice(2))}</h1>`); continue }

    if (t.startsWith('* ') || t.startsWith('- ') || t.startsWith('• ')) {
      if (!listOpen) { out.push('<ul>'); listOpen = true }
      out.push(`<li>${inlineBold(t.slice(2))}</li>`)
      continue
    }

    if (/^\d+\.\s/.test(t)) {
      if (!listOpen) { out.push('<ul>'); listOpen = true }
      out.push(`<li>${inlineBold(t.replace(/^\d+\.\s/, ''))}</li>`)
      continue
    }

    closeList()
    out.push(`<p>${inlineBold(t)}</p>`)
  }
  closeList()
  return out.join('\n')
}

// ─── Table ───────────────────────────────────────────────────────────────────
function renderTable(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const cls = cols.length > 8 ? ' class="data xwide"' : cols.length > 6 ? ' class="data wide"' : ' class="data"'

  const head = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')
  const body = rows
    .map((row) => `<tr>${cols.map((c) => `<td>${escapeHtml(fmtCell(row[c], c))}</td>`).join('')}</tr>`)
    .join('\n')

  return `<table${cls}><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`
}

// ─── Main export ─────────────────────────────────────────────────────────────
export function generateHtml({ rows, title, chart, report_text }: HtmlInput): Buffer {
  const parts: string[] = []

  if (title) parts.push(`<h1>${escapeHtml(title)}</h1>`)
  parts.push(`<p class="gen">Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</p>`)

  if (chart) parts.push(`<div class="chart">${renderChartSvg(chart)}</div>`)

  if (report_text?.trim()) parts.push(renderMarkdownContent(report_text))

  if (rows.length > 0) {
    parts.push('<h2>Detalhamento por Plataforma</h2>')
    parts.push(renderTable(rows))
  } else if (!report_text) {
    parts.push('<p class="empty">Sem resultados.</p>')
  }

  return Buffer.from(wrapPrintableHtml({ title, bodyHtml: parts.join('\n') }), 'utf8')
}
