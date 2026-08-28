/**
 * Checa a tradução de `checked` em checkUrls — o número pelo qual o cliente
 * avança no laço de lotes.
 *
 * Itens resolvidos por regra ("Home") ficam intercalados com os auditados pela
 * IA. Se `checked` somar as duas contagens em vez de medir o prefixo real, o
 * cliente pula URLs que ninguém checou — em silêncio, sem contar como falha.
 *
 *   npx tsx lib/urlCheck.test.ts
 */
import assert from 'node:assert';
import { isHomeRoot } from './verification';

type Item = { url: string; categoria: string; veiculo: string; impressoes: number };

/** O mesmo cálculo de prefixo de checkUrls, isolado para poder ser exercitado. */
function prefixo(items: Item[], done: number): number {
  let audited = 0, checked = 0;
  for (const item of items) {
    if (!isHomeRoot(item.url, item.categoria)) {
      if (audited >= done) break;
      audited++;
    }
    checked++;
  }
  return checked;
}

const it = (url: string, categoria: string): Item => ({ url, categoria, veiculo: 'V', impressoes: 1 });

// home, A, B, home, C — só A auditada
const mix = [
  it('https://globo.com', 'Home'),
  it('https://globo.com/a', 'Notícias'),
  it('https://globo.com/b', 'Notícias'),
  it('https://uol.com.br', 'Home'),
  it('https://globo.com/c', 'Notícias'),
];

assert.strictEqual(mix.filter((i) => isHomeRoot(i.url, i.categoria)).length, 2, 'fixture: 2 home esperadas');

// A soma ingênua (2 home + 1 auditada = 3) mandaria o cliente para o índice 3 e
// pularia B, que está no índice 2 e nunca foi checada.
assert.strictEqual(prefixo(mix, 1), 2, 'prefixo deve parar em B, a primeira não auditada');
assert.strictEqual(prefixo(mix, 0), 1, 'nada auditado: só a home inicial é prefixo');
assert.strictEqual(prefixo(mix, 2), 4, 'A e B auditadas: home seguinte entra no prefixo');
assert.strictEqual(prefixo(mix, 3), 5, 'tudo auditado: prefixo é a lista inteira');

// Sem nenhuma home o prefixo é a própria contagem de auditadas.
const semHome = [it('https://a.com/1', 'Notícias'), it('https://a.com/2', 'Notícias')];
assert.strictEqual(prefixo(semHome, 1), 1);
assert.strictEqual(prefixo(semHome, 2), 2);

// Só home: nada gasta prazo, tudo é prefixo.
const soHome = [it('https://a.com', 'Home'), it('https://b.com', 'Home')];
assert.strictEqual(prefixo(soHome, 0), 2);

console.log('OK — prefixo de checked não pula URLs não auditadas.');
