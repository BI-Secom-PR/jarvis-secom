import { Resend } from 'resend'

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
      <p>Olá, <strong>${name}</strong>!</p>
      <p>Seu acesso ao <strong>Jarvis SECOM</strong> foi aprovado por um administrador.</p>
      <p><a href="${BASE}/login">Clique aqui para entrar</a></p>
    `,
  })
}

