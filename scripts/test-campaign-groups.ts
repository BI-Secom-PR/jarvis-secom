// Check das regras de grupo de campanha:  npx tsx scripts/test-campaign-groups.ts
//
// Só as funções puras (parseRules/groupOf) — nada de banco. Os nomes usados são
// amostras reais do gold layer, colhidas ao vivo.

import assert from 'node:assert/strict';
import { DEFAULT_RULES, groupOf, parseRules } from '../lib/campaignGroups';

const rules = parseRules(DEFAULT_RULES);
const g = (name: string) => groupOf(name, rules);

// Comentário e linha vazia não viram regra.
assert.equal(rules.length, 15, `esperava 15 regras, veio ${rules.length}`);

// Regra simples, casando no meio do nome cru.
assert.equal(g('2026 | POSICIONAMENTO DO GOVERNO DO BRASIL | VISUALIZACAO | NACIONAL'),
  'Posicionamento do Governo do Brasil');
assert.equal(g('2026 | POSICIONAMENTO DE GOVERNO - CONECTANDO ENTREGAS E FUTURO | 20260013 | CALIA'),
  'Posicionamento do Governo do Brasil');

// AND de dois termos — e o mesmo prefixo caindo em rótulos diferentes por UF.
assert.equal(g('2026 | TRABALHO PELO BRASIL SANTA CATARINA | ALCANCE'), 'Trabalho pelo Brasil Santa Catarina');
assert.equal(g('2026 | TRABALHO PELO BRASIL RORAIMA | ALCANCE'), 'Trabalho pelo Brasil Roraima');
// Sem o 2º termo, nenhuma regra de UF casa e sobra o fallback do pipe.
assert.equal(g('2026 | TRABALHO PELO BRASIL PARAIBA | ALCANCE'), 'TRABALHO PELO BRASIL PARAIBA');

// "RIO GRANDE" sozinho casava RN e RS no mesmo grupo.
assert.equal(g('2026 | TRABALHO PELO BRASIL RIO GRANDE DO NORTE | VISUALIZACAO | NACIONAL'), 'Trabalho pelo Brasil Rio Grande do Norte');
assert.equal(g('2026 | TRABALHO PELO BRASIL | RIO GRANDE DO SUL | VISUALIZACAO | CALIA | Pi 140206'), 'Trabalho pelo Brasil Rio Grande do Sul');

// Palavra inteira: "IR" não casa dentro de FEVEREIRO / JANEIRO / DIRECIONAMENTO.
assert.equal(g('84516_Secom_Propeg_Midia Avulsa_Always On_Contra Feminicidio_Fevereiro 2026_PI 337.849_IGN'), 'Always On');
assert.equal(g('82683_Secom_Propeg_Always On_Janeiro26_PI 335.812 _IGN'), 'Always On');
assert.equal(g('2026 | Always ON | Visualização | Nacional - Joana 2 a 5  #2 Direcionamento detalhado - PI 117481'), 'Always On');
assert.equal(g('2025_ALWAYS-ON_BR_TRAFEGO_SECOM_13°e IR'), 'Always On IR');

// Acento e cedilha: o dado tem as duas grafias na mesma janela.
assert.equal(g('2026 | AÇÕES DE OPORTUNIDADE - ALWAYS ON 6 | ENGAJAMENTO | CALIA'), 'Always On');
assert.equal(g('2026 | AÇOES DE OPORTUNIDADE - ALWAYS ON  4 | 20260008 | CALIA'), 'Always On');

// Ordem é semântica: "ALWAYS + IR" tem de vencer o "ALWAYS" solto que vem depois.
assert.equal(g('2025_ALWAYS-ON_BR_TRAFEGO_SECOM_13°e IR'), 'Always On IR');
assert.equal(g('2026 | ALWAYS ON 20260015 | VISUALIZACAO | PROPEG'), 'Always On');

// Fallback: 2º segmento entre pipes, com trim.
assert.equal(g('2026 | DESENROLA BRASIL | VISUALIZACAO | NOVA | PI 326516'), 'DESENROLA BRASIL');
assert.equal(g('2026 | CNH DO BRASIL | ENGAJAMENTO | NACIONAL — MAIO'), 'CNH DO BRASIL');

// Um pipe só não é a convenção — devolve o nome cru, como o ELSE do Oracle.
assert.equal(g('SEM CONVENCAO | SO UM PIPE'), 'SEM CONVENCAO | SO UM PIPE');
assert.equal(g('2024_Fé no Brasil_Sul_Saúde'), '2024_Fé no Brasil_Sul_Saúde');

// Regra malformada (sem "=>") é ignorada sem derrubar as vizinhas.
const parcial = parseRules('lixo sem seta\nFOO => Bar\n');
assert.deepEqual(parcial, [{ terms: ['FOO'], label: 'Bar' }]);

console.log('ok — regras de grupo de campanha');
