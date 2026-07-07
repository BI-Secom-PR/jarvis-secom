/**
 * test-rag.ts — golden-set regression for the RAG retrieval (lib/rag.ts).
 *
 * Each case is a paraphrase of a library question; the matching library
 * example must appear in the real top-3 (live PG + live Google embedding).
 * Run after ANY change to the embedding model, dims, score floor, dedupe
 * or the example library itself.
 *
 * Run:  npm run test:rag   (bun --env-file=.env.local scripts/test-rag.ts)
 */
import { retrieveTop } from '../lib/rag'

type Case = { q: string; expect: string } // expect = substring of the library question

const CASES: Case[] = [
  { q: 'Qual visual dá mais resultado nos vídeos sobre saúde?', expect: 'Saúde, qual elemento visual' },
  { q: 'Nos vídeos de economia, o público prefere emoção ou números?', expect: 'Para Economia, o público responde melhor' },
  { q: 'Memes vão melhor em vídeo curto de 15s ou de 30s?', expect: 'Memes funcionam melhor em vídeos de 15 ou 30' },
  { q: 'Qual porta-voz rende mais na campanha da Escala 6x1?', expect: 'porta-voz funciona melhor nos vídeos da Escala 6x1' },
  { q: 'Top 10 códigos criativos com maior CTR', expect: '10 melhores códigos criativos por CTR' },
  { q: 'Quais campanhas estão rodando agora?', expect: 'campanhas estão ativas atualmente' },
  { q: 'Evolução dia a dia de gasto e impressões da campanha do Pé de Meia', expect: 'evolução diária de investimento e impressões' },
  { q: 'Breakdown regional da campanha de vacinação', expect: 'breakdown por região da campanha' },
  { q: 'Qual tema tem melhor VTR na região Nordeste?', expect: 'melhor VTR no Nordeste' },
  { q: 'Que faixa de idade mais engaja com economia?', expect: 'faixa etária engaja mais com o tema Economia' },
  { q: 'Qual duração de vídeo retém melhor a audiência por tema?', expect: 'duração de vídeo tem melhor taxa de conclusão' },
  { q: 'Investimento e alcance da Escala 6x1 no Facebook e Instagram', expect: 'investimento e o alcance da Escala 6x1 na Meta' },
  { q: 'CPV e VTR no Kwai usando video completions', expect: 'CPV e VTR no Kwai e LinkedIn' },
  { q: 'Qual formato de anúncio tem o custo por engajamento mais baixo?', expect: 'formato de peça tem o menor custo por engajamento' },
  { q: 'Bolsa Família: meme ou infográfico, o que rende mais?', expect: 'Bolsa Família, meme performa melhor que infográfico' },
  { q: 'Como o Bolsa Família vem performando mês a mês?', expect: 'Bolsa Família vem performando ao longo dos meses' },
  { q: 'Qual tema fala mais com mulheres de 25 a 34?', expect: 'tema ressoa mais com mulheres de 25 a 34' },
  { q: 'Influenciador rende mais como dark post ou como post impulsionado?', expect: 'dark post ou impulsionado' },
  { q: 'Quais combinações criativas estão com performance ruim e deveriam sair do ar?', expect: 'combinações criativas estão performando abaixo da média' },
  { q: 'Meme funciona melhor no TikTok ou no Instagram?', expect: 'Meme performa melhor em qual plataforma' },
]

async function main() {
  let failures = 0
  for (const c of CASES) {
    const top = await retrieveTop(c.q, 3)
    const hit = top.find((h) => h.question.includes(c.expect))
    const scores = top.map((h) => `${h.score.toFixed(3)} ${h.question.slice(0, 60)}`).join(' | ')
    if (hit) {
      console.log(`PASS  ${c.q}`)
    } else {
      failures++
      console.log(`FAIL  ${c.q}\n      esperado: "${c.expect}"\n      top-3: ${scores || '(vazio)'}`)
    }
  }
  console.log(`\n${CASES.length - failures}/${CASES.length} PASS`)
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
