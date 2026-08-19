import { isHomeRoot } from '../lib/verification';

const cases: [string, string, boolean][] = [
  ['https://g1.globo.com', 'Home', true],
  ['https://www.globo.com/', 'Home', true],
  ['https://www.uol.com.br/?utm_source=pwa&utm_medium=pwa', 'Home', true],
  ['https://www.brasil247.com/?source=pwa', 'Home', true],
  ['http://agazeta.net/', 'home', true],
  ['com.picpay', 'Home', true],
  ['https://www.bol.uol.com.br/mensagens/2024/09/23/mensagem.htm', 'Home', false],
  ['https://www.brasil247.com/apoio', 'Home', false],
  ['https://revistaforum.com.br/', 'Política', false],
  ['https://g1.globo.com/politica/noticia/x.ghtml', 'Notícia', false],
];

for (const [url, cat, want] of cases) {
  const got = isHomeRoot(url, cat);
  if (got !== want) throw new Error(`isHomeRoot(${url}, ${cat}) = ${got}, esperado ${want}`);
}
console.log(`ok — ${cases.length} casos`);
