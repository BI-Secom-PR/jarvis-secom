import PDFDocument from 'pdfkit'
import SVGtoPDF from 'svg-to-pdfkit'
import { renderChartSvg, CHART_SVG_DIMS } from './chart-svg'
import type { ChartSpec } from './types'

interface PdfInput {
  rows: Record<string, unknown>[]
  title?: string
  chart?: ChartSpec
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toLocaleDateString('pt-BR')
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? v.toLocaleString('pt-BR')
      : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return String(v)
}

export async function generatePdf({ rows, title, chart }: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: title || 'Jarvis Export' } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    if (title) {
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(title, { align: 'left' })
      doc.moveDown(0.5)
    }
    doc.font('Helvetica').fontSize(9).fillColor('#666').text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, { align: 'left' })
    doc.moveDown(1)

    if (chart) {
      const svg = renderChartSvg(chart)
      const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right
      const ratio = CHART_SVG_DIMS.height / CHART_SVG_DIMS.width
      const w = pageW
      const h = w * ratio
      SVGtoPDF(doc, svg, doc.x, doc.y, { width: w, height: h, preserveAspectRatio: 'xMidYMid meet' })
      doc.y = doc.y + h + 20
    }

    if (rows.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(11).fillColor('#666').text('Sem resultados.')
      doc.end()
      return
    }

    const cols = Object.keys(rows[0])
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right
    const colW = pageW / cols.length
    const rowH = 18
    const headerH = 22

    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff')
      const x0 = doc.page.margins.left
      const y = doc.y
      doc.rect(x0, y, pageW, headerH).fill('#1f2937')
      cols.forEach((c, i) => {
        doc.fillColor('#fff').text(c, x0 + i * colW + 4, y + 6, { width: colW - 8, lineBreak: false, ellipsis: true })
      })
      doc.y = y + headerH
      doc.fillColor('#000')
    }

    drawHeader()
    doc.font('Helvetica').fontSize(8.5).fillColor('#222')

    rows.forEach((row, idx) => {
      if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
        doc.addPage()
        drawHeader()
        doc.font('Helvetica').fontSize(8.5).fillColor('#222')
      }
      const x0 = doc.page.margins.left
      const y = doc.y
      if (idx % 2 === 0) doc.rect(x0, y, pageW, rowH).fill('#f5f7fb').fillColor('#222')
      cols.forEach((c, i) => {
        doc.fillColor('#222').text(fmtCell(row[c]), x0 + i * colW + 4, y + 5, { width: colW - 8, lineBreak: false, ellipsis: true })
      })
      doc.y = y + rowH
    })

    doc.end()
  })
}
