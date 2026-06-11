import { generateXlsx } from './xlsx'
import { generateCsv } from './csv'
import { generateHtml } from './html'
import { MIME, sanitizeFilename, type GenerateInput, type GenerateOutput } from './types'

export async function generateExport(input: GenerateInput): Promise<GenerateOutput> {
  const filename = sanitizeFilename(input.filename || input.title, input.format)
  const mimeType = MIME[input.format]

  let buffer: Buffer
  if (input.format === 'xlsx') {
    buffer = await generateXlsx(input.rows, input.title)
  } else if (input.format === 'csv') {
    buffer = generateCsv(input.rows)
  } else {
    buffer = generateHtml({ rows: input.rows, title: input.title, chart: input.chart, report_text: input.report_text })
  }

  return { buffer, mimeType, filename }
}

export { MIME, sanitizeFilename } from './types'
export type { ExportFormat, ChartSpec, GenerateInput, GenerateOutput } from './types'
