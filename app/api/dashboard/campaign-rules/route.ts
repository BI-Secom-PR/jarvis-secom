import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';
import {
  RULES_KEY, invalidateCampaignRules, loadCampaignRules, parseRules,
} from '@/lib/campaignGroups';

export const dynamic = 'force-dynamic';

// Teto folgado: o CASE do Oracle inteiro cabe em ~2 kB. Existe para o textarea não
// virar um vetor de entupir o Postgres.
const MAX_BYTES = 20_000;

export async function GET() {
  await requireAdmin();
  const { text, rules } = await loadCampaignRules();
  return NextResponse.json({ rules: text, count: rules.length });
}

export async function PUT(req: NextRequest) {
  const user = await requireAdmin();

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const text = (body as { rules?: unknown })?.rules;
  if (typeof text !== 'string') return NextResponse.json({ error: 'Campo "rules" ausente' }, { status: 400 });
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    return NextResponse.json({ error: `As regras passaram de ${MAX_BYTES} bytes` }, { status: 400 });
  }

  await db
    .insert(appSettings)
    .values({ key: RULES_KEY, value: text })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: text, updatedAt: new Date() } });
  invalidateCampaignRules();

  const count = parseRules(text).length;
  console.log(`[campaign-rules] ${user.email} salvou ${count} regra(s)`);
  return NextResponse.json({ ok: true, count });
}
