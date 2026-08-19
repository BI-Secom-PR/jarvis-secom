/**
 * "Home" é uma categoria válida das planilhas de verification: a raiz do site.
 * Raiz classificada como Home está correta por definição — não precisa de IA
 * (que costumava sugerir "Notícias" ao ler o conteúdo do portal). Caminho
 * interno marcado como Home continua indo para a IA: é erro real do adserver.
 */
export function isHomeRoot(url: string, categoria: string): boolean {
  if (categoria.trim().toLowerCase() !== 'home') return false;
  const raw = (url ?? '').trim();
  if (!raw) return true;
  try {
    // ponytail: sem esquema (ex. bundle id "com.picpay") o URL() falha e o
    // fallback abaixo trata como raiz — é o que esses registros são.
    const path = new URL(raw.includes('://') ? raw : `https://${raw}`).pathname;
    return path === '' || path === '/';
  } catch {
    return true;
  }
}
