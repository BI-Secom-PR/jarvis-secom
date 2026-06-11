import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { db } from '@/lib/db'
import { fileExports } from '@/lib/db/schema'
import { escapeHtml, wrapPrintableHtml } from '@/lib/exports/html'
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

// Printable HTML page with the chart PNG embedded as a data URI — opens in a
// browser tab where the user saves it as PDF via the print dialog. The data
// URI is rebuilt from the validated Buffer, never from the raw client string.
function buildHtml(png: Buffer, title?: string): Buffer {
  const bodyHtml = [
    title ? `<h1>${escapeHtml(title)}</h1>` : '',
    `<p class="gen">Gerado em ${escapeHtml(new Date().toLocaleString('pt-BR'))}</p>`,
    `<div class="chart"><img src="data:image/png;base64,${png.toString('base64')}" alt="${escapeHtml(title || 'Gráfico')}"></div>`,
  ].filter(Boolean).join('\n')
  return Buffer.from(wrapPrintableHtml({ title: title || 'Gráfico', bodyHtml }), 'utf8')
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
  const buffer = buildHtml(png, title)
  const filename = sanitizeFilename(title || 'grafico', 'html')
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  const [row] = await db
    .insert(fileExports)
    .values({
      userId: user.id,
      chatSessionId: sessionId ?? null,
      filename,
      mimeType: MIME.html,
      bytes: buffer,
      sizeBytes: buffer.byteLength,
      expiresAt,
    })
    .returning({ id: fileExports.id })
  return NextResponse.json({ id: row.id, url: `/api/exports/${row.id}`, filename })
}
