import ExcelJS from 'exceljs'

function addSheet(wb: ExcelJS.Workbook, rows: Record<string, unknown>[], title?: string) {
  const ws = wb.addWorksheet((title || 'Dados').slice(0, 30))

  if (rows.length === 0) {
    ws.addRow(['Sem resultados'])
    return
  }

  const columns = Object.keys(rows[0])
  ws.columns = columns.map((key) => ({ header: key, key, width: Math.min(Math.max(key.length + 4, 12), 40) }))

  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of rows) {
    const values = columns.map((c) => {
      const v = row[c]
      if (v === null || v === undefined) return ''
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
      if (v instanceof Date) return v
      return String(v)
    })
    ws.addRow(values)
  }

  // Column formatting
  columns.forEach((key, idx) => {
    const sample = rows.find((r) => r[key] !== null && r[key] !== undefined)?.[key]
    const col = ws.getColumn(idx + 1)
    if (typeof sample === 'number') {
      col.numFmt = Number.isInteger(sample) ? '#,##0' : '#,##0.00'
    } else if (sample instanceof Date) {
      col.numFmt = 'dd/mm/yyyy'
    }
  })
}

function newWorkbook() {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Jarvis SECOM'
  wb.created = new Date()
  return wb
}

/** Uma aba por conjunto, mesma formatação da planilha única. */
export async function generateXlsxSheets(sheets: { title: string; rows: Record<string, unknown>[] }[]): Promise<Buffer> {
  const wb = newWorkbook()
  for (const s of sheets) addSheet(wb, s.rows, s.title)
  if (!sheets.length) addSheet(wb, [], 'Dados')
  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}

export async function generateXlsx(rows: Record<string, unknown>[], title?: string): Promise<Buffer> {
  return generateXlsxSheets([{ title: title || 'Dados', rows }])
}
