import PDFDocument from 'pdfkit'
import SVGtoPDF from 'svg-to-pdfkit'
import { renderChartSvg, CHART_SVG_DIMS } from './chart-svg'
import type { ChartSpec } from './types'

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  dark:       '#1e293b',
  metricsBg:  '#f59e0b',
  platformBg: '#1e3a5f',
  rowAlt:     '#f1f5f9',
  text:       '#1e293b',
  muted:      '#64748b',
  white:      '#ffffff',
}

interface PdfInput {
  rows: Record<string, unknown>[]
  title?: string
  chart?: ChartSpec
  report_text?: string
}

// ─── Smart cell formatter ───────────────────────────────────────────────────
// MySQL returns decimals as strings ("0.039113..."), so we parse both number
// and numeric-string values before applying formatting logic.
function fmtCell(v: unknown, colName = ''): string {
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

// ─── Inline bold ─────────────────────────────────────────────────────────────
// KEY RULE: only first segment gets (x, y, width). Subsequent segments get
// ONLY { continued } — no width, no x/y — so pdfkit reuses the same text box.
function renderInlineBold(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
) {
  const parts = text.split(/(\*\*[^*]+\*\*)/).filter((p) => p.length > 0)
  if (!parts.length) return

  parts.forEach((part, i) => {
    const isLast = i === parts.length - 1
    const isBold = part.startsWith('**') && part.endsWith('**')
    const content = isBold ? part.slice(2, -2) : part
    doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica')
    if (i === 0) {
      doc.text(content, x, y, { width, continued: !isLast })
    } else {
      doc.text(content, { continued: !isLast })
    }
  })
}

// ─── Metrics bar ─────────────────────────────────────────────────────────────
function renderMetricsBar(doc: PDFKit.PDFDocument, line: string, x0: number, pageW: number) {
  const raw = line.replace(/^\[METRICS\]\s*/i, '').trim()
  const items = raw.split('|').map((s) => s.trim()).filter(Boolean)
  if (!items.length) return

  const boxH = 68
  const boxY = doc.y
  doc.rect(x0, boxY, pageW, boxH).fill(C.metricsBg)

  const cellW = pageW / items.length
  items.forEach((item, i) => {
    const colon = item.indexOf(':')
    const label = colon >= 0 ? item.slice(0, colon).trim() : item
    const value = colon >= 0 ? item.slice(colon + 1).trim() : ''
    const cx = x0 + cellW * i
    doc.font('Helvetica-Bold').fontSize(19).fillColor(C.dark)
      .text(value, cx + 4, boxY + 10, { width: cellW - 8, align: 'center', lineBreak: false })
    doc.font('Helvetica').fontSize(7.5).fillColor(C.dark)
      .text(label, cx + 4, boxY + 38, { width: cellW - 8, align: 'center', lineBreak: false })
  })
  doc.y = boxY + boxH + 10
}

// ─── Platforms box ───────────────────────────────────────────────────────────
function renderPlatformsBox(doc: PDFKit.PDFDocument, line: string, x0: number, pageW: number) {
  const text = line.replace(/^\[PLATFORMS\]\s*/i, '').trim()
  if (!text) return

  // Measure how many lines the text needs
  const boxY = doc.y
  const innerH = 36
  doc.rect(x0, boxY, pageW, innerH).fill(C.platformBg)

  // Bold "Plataformas:" + normal text — first segment anchors the box
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
    .text('Plataformas:  ', x0 + 12, boxY + 14, { width: pageW - 24, continued: true })
  doc.font('Helvetica').fontSize(9).fillColor(C.white)
    .text(text, { continued: false })

  doc.y = boxY + innerH + 10
}

// ─── Section header ──────────────────────────────────────────────────────────
function renderSectionHeader(doc: PDFKit.PDFDocument, title: string, x0: number, pageW: number) {
  const boxY = doc.y
  doc.rect(x0, boxY, pageW, 26).fill(C.dark)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white)
    .text(title.toUpperCase(), x0, boxY + 8, { width: pageW, align: 'center', lineBreak: false })
  doc.y = boxY + 26 + 10
}

// ─── Bullet ──────────────────────────────────────────────────────────────────
function renderBullet(doc: PDFKit.PDFDocument, text: string, x0: number, pageW: number) {
  doc.fontSize(9.5).fillColor(C.text)
  const y = doc.y
  // Prepend bullet symbol — renderInlineBold handles the bold markers inside
  renderInlineBold(doc, '•  ' + text.trim(), x0 + 6, y, pageW - 6)
  doc.moveDown(0.3)
}

// ─── Paragraph ───────────────────────────────────────────────────────────────
function renderParagraph(doc: PDFKit.PDFDocument, text: string, x0: number, pageW: number) {
  doc.fontSize(9.5).fillColor(C.text)
  const y = doc.y
  renderInlineBold(doc, text.trim(), x0, y, pageW)
  doc.moveDown(0.4)
}

// ─── Markdown dispatcher ─────────────────────────────────────────────────────
function renderMarkdownContent(
  doc: PDFKit.PDFDocument,
  content: string,
  x0: number,
  pageW: number,
) {
  for (const line of content.split('\n')) {
    const t = line.trim()

    if (!t) { doc.moveDown(0.25); continue }

    if (/^\[METRICS\]/i.test(t)) { renderMetricsBar(doc, t, x0, pageW); continue }
    if (/^\[PLATFORMS\]/i.test(t)) { renderPlatformsBox(doc, t, x0, pageW); continue }

    if (t.startsWith('## ')) { doc.moveDown(0.4); renderSectionHeader(doc, t.slice(3), x0, pageW); continue }

    if (t.startsWith('### ')) {
      doc.moveDown(0.3)
      doc.font('Helvetica-Bold').fontSize(11).fillColor(C.text)
        .text(t.slice(4), x0, doc.y, { width: pageW })
      doc.moveDown(0.2)
      continue
    }

    if (t.startsWith('# ')) {
      doc.moveDown(0.4)
      doc.font('Helvetica-Bold').fontSize(14).fillColor(C.text)
        .text(t.slice(2), x0, doc.y, { width: pageW })
      doc.moveDown(0.3)
      continue
    }

    if (t.startsWith('* ') || t.startsWith('- ') || t.startsWith('• ')) {
      renderBullet(doc, t.slice(2), x0, pageW)
      continue
    }

    if (/^\d+\.\s/.test(t)) {
      renderBullet(doc, t.replace(/^\d+\.\s/, ''), x0, pageW)
      continue
    }

    renderParagraph(doc, t, x0, pageW)
  }
}

// ─── Table ───────────────────────────────────────────────────────────────────
function renderTable(
  doc: PDFKit.PDFDocument,
  rows: Record<string, unknown>[],
  x0: number,
  pageW: number,
) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const colW = pageW / cols.length
  // Scale down font for wide tables so numbers fit without wrapping
  const fontSize = cols.length > 8 ? 7 : cols.length > 6 ? 7.5 : 8.5
  const rowH = cols.length > 6 ? 15 : 18
  const headerH = cols.length > 6 ? 18 : 22

  const drawHeader = () => {
    const y = doc.y
    doc.rect(x0, y, pageW, headerH).fill(C.dark)
    doc.font('Helvetica-Bold').fontSize(fontSize).fillColor(C.white)
    cols.forEach((c, i) => {
      doc.text(c, x0 + i * colW + 3, y + (headerH - fontSize) / 2, { width: colW - 6, lineBreak: false, ellipsis: true })
    })
    doc.y = y + headerH
  }

  drawHeader()
  doc.font('Helvetica').fontSize(fontSize - 0.5).fillColor(C.text)

  rows.forEach((row, idx) => {
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 10) {
      doc.addPage()
      renderFooter(doc, x0, pageW)
      drawHeader()
      doc.font('Helvetica').fontSize(fontSize - 0.5).fillColor(C.text)
    }
    const y = doc.y
    if (idx % 2 === 0) doc.rect(x0, y, pageW, rowH).fill(C.rowAlt).fillColor(C.text)
    cols.forEach((c, i) => {
      doc.fillColor(C.text)
        .text(fmtCell(row[c], c), x0 + i * colW + 4, y + 5, { width: colW - 8, lineBreak: false, ellipsis: true })
    })
    doc.y = y + rowH
  })
}

// ─── Footer ──────────────────────────────────────────────────────────────────
// Uses the reserved bottom margin zone (margins.bottom = 55) so pdfkit never
// auto-paginates when drawing the footer rect/text.
function renderFooter(doc: PDFKit.PDFDocument, x0: number, pageW: number) {
  const y = doc.page.height - doc.page.margins.bottom + 6
  doc.rect(x0, y, pageW, 22).fill(C.dark)
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white)
    .text('Núcleo de BI  |  NM Secom  |  SPP', x0, y + 7, { width: pageW, align: 'center', lineBreak: false })
}

// ─── Main export ─────────────────────────────────────────────────────────────
export async function generatePdf({ rows, title, chart, report_text }: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const margin = 40
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: margin, left: margin, right: margin, bottom: 55 },
      info: { Title: title || 'Jarvis Export' },
    })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const pageW = doc.page.width - margin * 2
    const x0 = margin

    // Title
    if (title) {
      doc.font('Helvetica-Bold').fontSize(17).fillColor(C.text)
        .text(title, x0, doc.y, { width: pageW })
      doc.moveDown(0.25)
    }
    doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
      .text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, x0, doc.y, { width: pageW })
    doc.moveDown(0.8)

    // Optional chart
    if (chart) {
      const svg = renderChartSvg(chart)
      const ratio = CHART_SVG_DIMS.height / CHART_SVG_DIMS.width
      const h = pageW * ratio
      SVGtoPDF(doc, svg, x0, doc.y, { width: pageW, height: h, preserveAspectRatio: 'xMidYMid meet' })
      doc.y = doc.y + h + 16
    }

    // Narrative report
    if (report_text?.trim()) {
      renderMarkdownContent(doc, report_text, x0, pageW)
      doc.moveDown(0.5)
    }

    // Data table
    if (rows.length > 0) {
      renderSectionHeader(doc, 'Detalhamento por Plataforma', x0, pageW)
      renderTable(doc, rows, x0, pageW)
    } else if (!report_text) {
      doc.font('Helvetica-Oblique').fontSize(11).fillColor(C.muted).text('Sem resultados.')
    }

    renderFooter(doc, x0, pageW)
    doc.end()
  })
}
