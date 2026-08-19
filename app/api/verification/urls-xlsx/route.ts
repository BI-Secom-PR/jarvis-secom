import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateXlsx } from '@/lib/exports/xlsx';

type Row = {
  url: string;
  veiculo: string;
  categoria: string;
  status: string;
  categoria_sugerida: string | null;
  impressoes: number;
  pct: number;
  reason: string;
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rows, name } = (await req.json()) as { rows?: Row[]; name?: string };
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Sem URLs para exportar' }, { status: 400 });
  }

  const buffer = await generateXlsx(
    rows.map((r) => ({
      'Veículo': r.veiculo ?? '',
      'URL': r.url ?? '',
      'Categoria (adserver)': r.categoria ?? '',
      'Status': r.status ?? '',
      'Categoria sugerida': r.categoria_sugerida ?? '',
      'Impressões': r.impressoes ?? 0,
      '% do veículo': r.pct ?? 0,
      'Justificativa': r.reason ?? '',
    })),
    'URLs auditadas',
  );

  const fileName = `${(name || 'URLs auditadas').replace(/\.xlsx$/i, '')} - URLs auditadas.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
}
