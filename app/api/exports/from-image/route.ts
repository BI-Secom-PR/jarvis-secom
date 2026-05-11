import { NextRequest, NextResponse } from 'next/server'
import PDFDocument from 'pdfkit'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { fileExports } from '@/lib/db/schema'
import { sanitizeFilename, MIME } from '@/lib/exports/types'

const EXPIRY_DAYS = 7
const MAX_PNG_BYTES = 8 * 1024 * 1024

function pngFromDataUrl(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length > MAX_PNG_BYTES) return null
  return buf
}

async function buildPdf(png: Buffer, title?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: title || 'Grafico' } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    if (title) {
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(title)
      doc.moveDown(0.3)
    }
    doc.font('Helvetica').fontSize(9).fillColor('#666').text(`Gerado em ${new Date().toLocaleString('pt-BR')}`)
    doc.moveDown(1)
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right
    doc.image(png, { fit: [pageW, 460], align: 'center' })
    doc.end()
  })
}

export async function POST(req: NextRequest) {
  const user = await requireAuth()
  const body = await req.json().catch(() => null)
  if (!body || typeof body.png !== 'string') {
    return NextResponse.json({ error: 'png (data URL) required' }, { status: 400 })
  }
  const png = pngFromDataUrl(body.png)
  if (!png) return NextResponse.json({ error: 'invalid or oversized png' }, { status: 400 })
  const title: string | undefined = typeof body.title === 'string' ? body.title.slice(0, 200) : undefined
  const sessionId: string | undefined = typeof body.chatSessionId === 'string' ? body.chatSessionId : undefined
  const buffer = await buildPdf(png, title)
  const filename = sanitizeFilename(title || 'grafico', 'pdf')
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  const [row] = await db
    .insert(fileExports)
    .values({
      userId: user.id,
      chatSessionId: sessionId ?? null,
      filename,
      mimeType: MIME.pdf,
      bytes: buffer,
      sizeBytes: buffer.byteLength,
      expiresAt,
    })
    .returning({ id: fileExports.id })
  return NextResponse.json({ id: row.id, url: `/api/exports/${row.id}`, filename })
}
