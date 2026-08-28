// Check do topo do eixo Y dos gráficos (tela + export usam o mesmo helper).
// Roda: npx tsx scripts/test-chart-axis.ts
//
// O bug que ele guarda: o eixo era o maior valor cru dividido por 4, então um
// pico de 2.884 interações rendia o rótulo "778,68" — centavos num eixo de
// contagem. Ver components/ChartWidget.tsx (GridLines) e lib/exports/chart-svg.ts.

import assert from 'node:assert';
import { niceAxisMax } from '../lib/exports/chart-palette';

// Mesmo formatador dos rótulos (ChartWidget.formatCompact, resumido no que importa).
const fmt = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} Bi`;
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} Mi`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} k`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};
const ticks = (max: number) => [1, 2, 3, 4].map((i) => fmt((max * i) / 4));

// Contagens: o eixo cobre o dado, sobra pouco e nenhum rótulo vira fração.
for (const v of [3, 7, 42, 137, 999, 1000, 2884, 80_283_474, 171_711_414]) {
  const max = niceAxisMax(v);
  assert.ok(max >= v, `eixo ${max} não cobre ${v}`);
  assert.ok(max <= v * 2, `eixo ${max} sobra demais para ${v}`);
  // O que não pode é o VALOR do rótulo ser fracionário ("778,68"); "1,5 k" é só
  // o formato compacto de 1500, que é inteiro.
  for (const i of [1, 2, 3, 4]) {
    assert.ok(Number.isInteger((max * i) / 4), `rótulo fracionário ${(max * i) / 4} para max ${v}`);
  }
}

// O caso da imagem: 2.858 curtidas + 26 compart. empilhados.
assert.deepEqual(ticks(niceAxisMax(2884)), ['750', '1,5 k', '2,3 k', '3 k']);

// Taxas continuam com casa decimal — só o eixo de contagem é que é inteiro.
assert.deepEqual(ticks(niceAxisMax(0.34)), ['0,1', '0,2', '0,3', '0,4']);

// Degenerados não podem virar NaN nem eixo zerado.
for (const v of [0, -5, NaN, Infinity]) assert.ok(niceAxisMax(v) > 0);

console.log('ok — topo do eixo dos gráficos');
