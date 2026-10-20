import { Resend } from 'resend'

const escHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))

export async function sendNewDeviceEmail(to: string, name: string, device: string, ip: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping new-device alert to', to)
    return
  }

  const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  await new Resend(apiKey).emails.send({
    from: process.env.RESEND_FROM ?? 'noreply@example.com',
    to,
    subject: 'Novo acesso à sua conta do Jarvis SECOM',
    html: `
      <p>Olá, <strong>${escHtml(name)}</strong>!</p>
      <p>Sua conta acabou de ser acessada de um dispositivo que não víamos antes:</p>
      <ul>
        <li>Dispositivo: <strong>${escHtml(device)}</strong></li>
        <li>IP: ${escHtml(ip)}</li>
      </ul>
      <p>Se foi você, pode ignorar este e-mail. Se não foi, <a href="${escHtml(BASE)}/perfil">encerre as sessões e troque sua senha</a>.</p>
    `,
  })
}

export async function sendApprovalEmail(to: string, name: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — skipping approval email to', to)
    return
  }

  const resend = new Resend(apiKey)
  const FROM   = process.env.RESEND_FROM ?? 'noreply@example.com'
  const BASE   = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Seu acesso ao Jarvis SECOM foi aprovado!',
    html: `
      <p>Olá, <strong>${escHtml(name)}</strong>!</p>
      <p>Seu acesso ao <strong>Jarvis SECOM</strong> foi aprovado por um administrador.</p>
      <p><a href="${escHtml(BASE)}/login">Clique aqui para entrar</a></p>
    `,
  })
}

