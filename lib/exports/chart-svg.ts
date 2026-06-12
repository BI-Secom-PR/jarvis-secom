import type { ChartSpec } from './types'

const W = 720
const H = 380
const PAD = { top: 48, right: 30, bottom: 56, left: 70 }

/* Print-safe palette — same hues as the in-app ChartWidget, tuned for white background */
const COLORS = [
  { main: '#3b5bdb', light: '#6ea8ff' }, // blue
  { main: '#7048e8', light: '#b197fc' }, // violet
  { main: '#0ca678', light: '#3bd4c0' }, // teal
  { main: '#d6336c', light: '#f783ac' }, // magenta
  { main: '#f08c00', light: '#ffd43b' }, // amber
  { main: '#1098ad', light: '#66d9e8' }, // cyan
]

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* pt-BR compact: 1.234.567 → "1,2 Mi", 4.500 → "4,5 Mil" */
function fmt(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' Bi'
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' Mi'
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + ' Mil'
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')
}

function innerSize() {
  return { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom }
}

/* Round up to 1/1.5/2/2.5/3/4/5/6/8/10 × 10^n so axis ticks land on clean values */
function niceMax(raw: number): number {
  if (raw <= 0) return 1
  const exp = Math.floor(Math.log10(raw))
  const base = Math.pow(10, exp)
  const frac = raw / base
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const nice = steps.find((s) => frac <= s) ?? 10
  return nice * base
}

/* Rect with rounded top corners only */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h)
  return `M${(x).toFixed(1)},${(y + h).toFixed(1)} V${(y + rr).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + rr).toFixed(1)},${y.toFixed(1)} H${(x + w - rr).toFixed(1)} Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + rr).toFixed(1)} V${(y + h).toFixed(1)} Z`
}

/* Smooth monotone-ish curve through points (Catmull-Rom → cubic Bézier) */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

function seriesPoints(data: number[], max: number): { x: number; y: number }[] {
  const { w, h } = innerSize()
  const stepX = data.length > 1 ? w / (data.length - 1) : w
  return data.map((v, i) => ({
    x: PAD.left + stepX * i,
    y: PAD.top + h - ((v ?? 0) / max) * h,
  }))
}

function xLabels(labels: string[]): string {
  const { w } = innerSize()
  const n = labels.length
  if (n === 0) return ''
  /* Skip labels when crowded so they stay legible */
  const maxLabels = 12
  const every = Math.max(1, Math.ceil(n / maxLabels))
  const stepX = n > 1 ? w / (n - 1) : w
  const out: string[] = []
  labels.forEach((label, i) => {
    if (i % every !== 0 && i !== n - 1) return
    const x = PAD.left + stepX * i
    out.push(`<text x="${x.toFixed(1)}" y="${(H - PAD.bottom + 20).toFixed(1)}" text-anchor="middle" font-size="11" fill="#64748b">${esc(label)}</text>`)
  })
  return out.join('')
}

function gridAndTicks(max: number): string {
  const { h, w } = innerSize()
  const ticks = 4
  const out: string[] = []
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i
    const y = PAD.top + h - (h * i) / ticks
    out.push(`<text x="${(PAD.left - 10).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="#94a3b8">${esc(fmt(v))}</text>`)
    if (i > 0) out.push(`<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${PAD.left + w}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="3 5"/>`)
  }
  out.push(`<line x1="${PAD.left}" y1="${(PAD.top + h).toFixed(1)}" x2="${PAD.left + w}" y2="${(PAD.top + h).toFixed(1)}" stroke="#cbd5e1"/>`)
  return out.join('')
}

function barGradients(count: number): string {
  return Array.from({ length: Math.min(count, COLORS.length) }, (_, i) => {
    const c = COLORS[i]
    return `<linearGradient id="bar-g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c.light}"/><stop offset="100%" stop-color="${c.main}"/></linearGradient>`
  }).join('')
}

function renderBar(spec: ChartSpec): string {
  const { w, h } = innerSize()
  const max = niceMax(Math.max(1, ...spec.datasets.flatMap((d) => d.data)))
  const groupWidth = w / spec.labels.length
  const barWidth = Math.min(44, (groupWidth * 0.66) / spec.datasets.length)
  const groupInner = barWidth * spec.datasets.length

  const out: string[] = [`<defs>${barGradients(spec.datasets.length)}</defs>`, gridAndTicks(max)]
  spec.labels.forEach((label, li) => {
    spec.datasets.forEach((ds, di) => {
      const v = ds.data[li] ?? 0
      const bh = (v / max) * h
      const x = PAD.left + groupWidth * li + (groupWidth - groupInner) / 2 + di * barWidth
      const y = PAD.top + (h - bh)
      out.push(`<path d="${topRoundedRect(x + 1, y, barWidth - 2, bh, 5)}" fill="url(#bar-g${di % COLORS.length})"/>`)
    })
    const tx = PAD.left + groupWidth * li + groupWidth / 2
    out.push(`<text x="${tx.toFixed(1)}" y="${(H - PAD.bottom + 20).toFixed(1)}" text-anchor="middle" font-size="11" fill="#64748b">${esc(label)}</text>`)
  })
  return out.join('')
}

function renderLine(spec: ChartSpec, withArea: boolean): string {
  const { h } = innerSize()
  const max = niceMax(Math.max(1, ...spec.datasets.flatMap((d) => d.data)))
  const baseline = PAD.top + h

  const defs = spec.datasets
    .map((_, i) => {
      const c = COLORS[i % COLORS.length]
      return `<linearGradient id="area-g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c.main}" stop-opacity="0.28"/><stop offset="100%" stop-color="${c.main}" stop-opacity="0.02"/></linearGradient>`
    })
    .join('')

  const out: string[] = [`<defs>${defs}</defs>`, gridAndTicks(max)]
  spec.datasets.forEach((ds, di) => {
    const c = COLORS[di % COLORS.length]
    const pts = seriesPoints(ds.data, max)
    const curve = smoothPath(pts)
    if (withArea && pts.length > 1) {
      const close = ` L${pts[pts.length - 1].x.toFixed(1)},${baseline.toFixed(1)} L${pts[0].x.toFixed(1)},${baseline.toFixed(1)} Z`
      out.push(`<path d="${curve}${close}" fill="url(#area-g${di})"/>`)
    }
    out.push(`<path d="${curve}" fill="none" stroke="${c.main}" stroke-width="2.5" stroke-linecap="round"/>`)
    /* Endpoint markers anchor the series visually */
    const last = pts[pts.length - 1]
    if (last) out.push(`<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3.5" fill="${c.main}" stroke="#fff" stroke-width="1.5"/>`)
  })
  out.push(xLabels(spec.labels))
  return out.join('')
}

function renderPie(spec: ChartSpec): string {
  const cx = W * 0.34
  const cy = PAD.top + innerSize().h / 2
  const rOuter = Math.min(innerSize().h, W * 0.5) / 2
  const rInner = rOuter * 0.62
  const data = spec.datasets[0]?.data ?? []
  const total = data.reduce((a, b) => a + b, 0) || 1
  const padAngle = data.length > 1 ? 0.035 : 0

  let acc = 0
  const out: string[] = []
  data.forEach((v, i) => {
    const c = COLORS[i % COLORS.length]
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2 + padAngle / 2
    acc += v
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2 - padAngle / 2
    if (end <= start) return
    const large = end - start > Math.PI ? 1 : 0
    const x1o = cx + Math.cos(start) * rOuter
    const y1o = cy + Math.sin(start) * rOuter
    const x2o = cx + Math.cos(end) * rOuter
    const y2o = cy + Math.sin(end) * rOuter
    const x1i = cx + Math.cos(end) * rInner
    const y1i = cy + Math.sin(end) * rInner
    const x2i = cx + Math.cos(start) * rInner
    const y2i = cy + Math.sin(start) * rInner
    out.push(
      `<path d="M${x1o.toFixed(1)},${y1o.toFixed(1)} A${rOuter},${rOuter} 0 ${large} 1 ${x2o.toFixed(1)},${y2o.toFixed(1)} L${x1i.toFixed(1)},${y1i.toFixed(1)} A${rInner},${rInner} 0 ${large} 0 ${x2i.toFixed(1)},${y2i.toFixed(1)} Z" fill="${c.main}"/>`,
    )
  })

  /* Center total */
  out.push(`<text x="${cx.toFixed(1)}" y="${(cy - 2).toFixed(1)}" text-anchor="middle" font-size="22" font-weight="bold" fill="#1e293b">${esc(fmt(total))}</text>`)
  out.push(`<text x="${cx.toFixed(1)}" y="${(cy + 18).toFixed(1)}" text-anchor="middle" font-size="10" letter-spacing="1.5" fill="#94a3b8">TOTAL</text>`)

  /* Side legend with values + share */
  const lx = W * 0.62
  let ly = cy - (data.length * 26) / 2 + 8
  data.forEach((v, i) => {
    const c = COLORS[i % COLORS.length]
    const pct = ((v / total) * 100).toFixed(1).replace('.', ',')
    out.push(`<circle cx="${lx}" cy="${(ly - 4).toFixed(1)}" r="5" fill="${c.main}"/>`)
    out.push(`<text x="${lx + 14}" y="${ly.toFixed(1)}" font-size="12" fill="#334155">${esc(spec.labels[i] ?? '')}</text>`)
    out.push(`<text x="${lx + 14}" y="${(ly + 13).toFixed(1)}" font-size="10.5" fill="#94a3b8">${esc(fmt(v))} · ${pct}%</text>`)
    ly += 34
  })
  return out.join('')
}

function legend(spec: ChartSpec): string {
  const out: string[] = []
  let x = PAD.left
  spec.datasets.forEach((ds, i) => {
    const c = COLORS[i % COLORS.length]
    out.push(`<circle cx="${x + 5}" cy="16" r="5" fill="${c.main}"/>`)
    out.push(`<text x="${x + 16}" y="20" font-size="11.5" fill="#475569">${esc(ds.label)}</text>`)
    x += 24 + ds.label.length * 6.5 + 16
  })
  return out.join('')
}

export function renderChartSvg(spec: ChartSpec): string {
  let body: string
  if (spec.type === 'line') body = renderLine(spec, false)
  else if (spec.type === 'area') body = renderLine(spec, true)
  else if (spec.type === 'pie') body = renderPie(spec)
  else body = renderBar(spec)

  const title = spec.title
    ? `<text x="${PAD.left}" y="22" font-size="14" font-weight="bold" fill="#1e293b">${esc(spec.title)}</text>`
    : ''
  const lg = spec.type === 'pie' || spec.datasets.length < 2 ? '' : legend(spec)
  const lgOffset = lg ? `<g transform="translate(0,${spec.title ? 18 : 0})">${lg}</g>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">${title}${lgOffset}${body}</svg>`
}

export const CHART_SVG_DIMS = { width: W, height: H }
