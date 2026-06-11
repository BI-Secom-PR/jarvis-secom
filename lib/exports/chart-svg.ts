import type { ChartSpec } from './types'

const W = 720
const H = 360
const PAD = { top: 40, right: 30, bottom: 60, left: 70 }
const COLORS = ['#2997ff', '#78dc78', '#ffa03c', '#c850c8', '#50dcdc', '#ffd166', '#ef476f']

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + 'M'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1).replace('.', ',') + 'k'
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')
}

function renderBar(spec: ChartSpec): string {
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const max = Math.max(1, ...spec.datasets.flatMap((d) => d.data))
  const groupWidth = innerW / spec.labels.length
  const barWidth = (groupWidth * 0.7) / spec.datasets.length

  const bars: string[] = []
  spec.labels.forEach((label, li) => {
    spec.datasets.forEach((ds, di) => {
      const v = ds.data[li] ?? 0
      const h = (v / max) * innerH
      const x = PAD.left + groupWidth * li + groupWidth * 0.15 + di * barWidth
      const y = PAD.top + (innerH - h)
      bars.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" fill="${COLORS[di % COLORS.length]}" rx="2"/>`)
    })
    const tx = PAD.left + groupWidth * li + groupWidth / 2
    bars.push(`<text x="${tx.toFixed(1)}" y="${(H - PAD.bottom + 16).toFixed(1)}" text-anchor="middle" font-size="11" fill="#444">${esc(label)}</text>`)
  })

  return axes(max) + bars.join('')
}

function renderLine(spec: ChartSpec): string {
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const max = Math.max(1, ...spec.datasets.flatMap((d) => d.data))
  const stepX = spec.labels.length > 1 ? innerW / (spec.labels.length - 1) : innerW

  const out: string[] = []
  spec.datasets.forEach((ds, di) => {
    const pts = ds.data.map((v, i) => {
      const x = PAD.left + stepX * i
      const y = PAD.top + innerH - (v / max) * innerH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    out.push(`<polyline fill="none" stroke="${COLORS[di % COLORS.length]}" stroke-width="2" points="${pts.join(' ')}"/>`)
  })
  spec.labels.forEach((label, i) => {
    const x = PAD.left + stepX * i
    out.push(`<text x="${x.toFixed(1)}" y="${(H - PAD.bottom + 16).toFixed(1)}" text-anchor="middle" font-size="11" fill="#444">${esc(label)}</text>`)
  })
  return axes(max) + out.join('')
}

function renderPie(spec: ChartSpec): string {
  const cx = W / 2
  const cy = H / 2 + 10
  const r = Math.min(innerSize().w, innerSize().h) / 2 - 10
  const data = spec.datasets[0]?.data ?? []
  const total = data.reduce((a, b) => a + b, 0) || 1
  let acc = 0
  const out: string[] = []
  data.forEach((v, i) => {
    const start = (acc / total) * Math.PI * 2 - Math.PI / 2
    acc += v
    const end = (acc / total) * Math.PI * 2 - Math.PI / 2
    const large = end - start > Math.PI ? 1 : 0
    const x1 = cx + Math.cos(start) * r
    const y1 = cy + Math.sin(start) * r
    const x2 = cx + Math.cos(end) * r
    const y2 = cy + Math.sin(end) * r
    out.push(`<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${COLORS[i % COLORS.length]}"/>`)
    const mid = (start + end) / 2
    const lx = cx + Math.cos(mid) * (r * 0.65)
    const ly = cy + Math.sin(mid) * (r * 0.65)
    out.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="11" fill="#fff">${esc(spec.labels[i] ?? '')}</text>`)
  })
  return out.join('')
}

function innerSize() {
  return { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom }
}

function axes(max: number): string {
  const innerH = H - PAD.top - PAD.bottom
  const ticks = 4
  const out: string[] = []
  out.push(`<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${H - PAD.bottom}" stroke="#999"/>`)
  out.push(`<line x1="${PAD.left}" y1="${H - PAD.bottom}" x2="${W - PAD.right}" y2="${H - PAD.bottom}" stroke="#999"/>`)
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i
    const y = PAD.top + innerH - (innerH * i) / ticks
    out.push(`<text x="${(PAD.left - 6).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#666">${esc(fmt(v))}</text>`)
    out.push(`<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}" stroke="#eee"/>`)
  }
  return out.join('')
}

function legend(spec: ChartSpec): string {
  const out: string[] = []
  spec.datasets.forEach((ds, i) => {
    const x = PAD.left + i * 140
    out.push(`<rect x="${x}" y="10" width="12" height="12" fill="${COLORS[i % COLORS.length]}"/>`)
    out.push(`<text x="${x + 18}" y="20" font-size="11" fill="#333">${esc(ds.label)}</text>`)
  })
  return out.join('')
}

export function renderChartSvg(spec: ChartSpec): string {
  let body: string
  if (spec.type === 'line') body = renderLine(spec)
  else if (spec.type === 'pie') body = renderPie(spec)
  else body = renderBar(spec)

  const title = spec.title
    ? `<text x="${W / 2}" y="${PAD.top - 18}" text-anchor="middle" font-size="14" font-weight="bold" fill="#222">${esc(spec.title)}</text>`
    : ''
  const lg = spec.type === 'pie' ? '' : legend(spec)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${title}${lg}${body}</svg>`
}

export const CHART_SVG_DIMS = { width: W, height: H }
