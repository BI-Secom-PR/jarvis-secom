export type ExportFormat = 'xlsx' | 'csv' | 'html'

export interface ChartSpec {
  type: 'bar' | 'line' | 'area' | 'pie'
  title?: string
  labels: string[]
  datasets: { label: string; data: number[] }[]
}

export interface GenerateInput {
  format: ExportFormat
  rows: Record<string, unknown>[]
  title?: string
  filename?: string
  chart?: ChartSpec
  report_text?: string
}

export interface GenerateOutput {
  buffer: Buffer
  mimeType: string
  filename: string
}

export const MIME: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv:  'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
}

export function sanitizeFilename(raw: string | undefined, format: ExportFormat): string {
  const base = (raw && raw.trim()) || `jarvis-export-${new Date().toISOString().slice(0, 10)}`
  const cleaned = base.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\-. ]+/g, '_').slice(0, 80)
  return `${cleaned}.${format}`
}
