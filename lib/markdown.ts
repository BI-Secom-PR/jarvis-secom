/**
 * Markdown → plain prose, for anything that is spoken or shown unstyled.
 *
 * The chat replies are full of tables, `**negrito**` and the `∣` that
 * `/api/chat` substitutes for pipes so markdown tables don't break. Read aloud
 * or rendered raw, all of that is noise, so it is stripped rather than
 * converted. Used by the voice overlay's transcript and by the TTS payload.
 */
export function speakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')                 // code fences
    .replace(/`([^`]+)`/g, '$1')                     // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')       // links/images → label
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')              // headers
    .replace(/^\s*>\s?/gm, '')                       // block quotes
    .replace(/\*\*([^*]+)\*\*/g, '$1')               // bold
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')      // italic
    .replace(/^[\s|:-]*[-:]{2,}[\s|:-]*$/gm, '')     // table rules
    .replace(/[|∣]/g, ' ')                           // table pipes + substitute
    .replace(/^\s*[-*+]\s+/gm, '')                   // bullets
    .replace(/^\s*(\d+)\.\s+/gm, '$1. ')             // keep numbered lists
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

// Abbreviations that end in a period without ending a sentence. PT-BR set
// plus the month shorthands the replies use.
const ABBREV =
  /^(?:sr|sra|srs|dr|dra|prof|profa|etc|ex|av|obs|aprox|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|n[º°]?|p|pp|vs)$/i;

/**
 * Index just past the end of the first sentence in `text`, or -1 if none has
 * finished yet. Used to cut streamed deltas into TTS-sized pieces.
 *
 * `min` keeps fragments from being sent one word at a time. A terminator only
 * counts when whitespace follows it, which is what keeps `1.234.567` and
 * `12.5%` intact — inside a number the next character is a digit, not a space.
 */
export function nextSentenceBoundary(text: string, min = 60): number {
  for (let i = Math.max(0, min - 1); i < text.length; i++) {
    const c = text[i];
    if (c === '\n') return i + 1;
    if (c !== '.' && c !== '!' && c !== '?' && c !== '…') continue;

    const next = text[i + 1];
    // Undefined means the stream may still be mid-token ("1.234"), so wait.
    if (next === undefined || !/\s/.test(next)) continue;

    if (c === '.') {
      const word = text.slice(0, i).match(/(\S+)$/)?.[1] ?? '';
      // "Sr." / "ago." / a lone initial are not sentence ends.
      if (ABBREV.test(word) || /^[\p{L}]$/u.test(word)) continue;
    }
    return i + 1;
  }
  return -1;
}

/**
 * Lightweight markdown-to-HTML renderer.
 * Ported from the original index.html vanilla JS implementation.
 */
export function renderMarkdown(text: string): string {
  // Escape HTML
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang: string, code: string) =>
    `<pre><code>${code.trim()}</code></pre>`
  );

  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Images
  s = s.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank"><img src="$2" alt="$1" onerror="this.style.display=\'none\'"></a>'
  );

  // Links (absolute https?:// or relative paths starting with /)
  s = s.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Markdown tables
  s = s.replace(/((?:^\|.+\|\n?)+)/gm, (block: string) => {
    const rows = block.trim().split('\n');
    if (rows.length < 2) return block;
    const isSeparator = (r: string) => /^\|[\s\-|:]+\|$/.test(r.trim());
    const parseCells = (row: string) =>
      row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

    let html = '<div class="table-wrapper"><table>';
    rows.forEach((row, i) => {
      if (isSeparator(row)) return;
      const cells = parseCells(row);
      const tag = i === 0 ? 'th' : 'td';
      html += '<tr>' + cells.map((c) => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
    });
    html += '</table></div>';
    return html;
  });

  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Headers
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Unordered lists
  s = s.replace(/((?:^[-*] .+\n?)+)/gm, (block: string) => {
    const items = block
      .trim()
      .split('\n')
      .map((l) => `<li>${l.replace(/^[-*] /, '')}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });

  // Numbered lists
  s = s.replace(/((?:^\d+\. .+\n?)+)/gm, (block: string) => {
    const items = block
      .trim()
      .split('\n')
      .map((l) => `<li>${l.replace(/^\d+\. /, '')}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  });

  // Horizontal rule
  s = s.replace(
    /^---$/gm,
    '<hr style="border-color:rgba(255,255,255,0.1);margin:12px 0">'
  );

  // Paragraphs (double newline)
  s = s.replace(/\n\n+/g, '</p><p>');
  // Single newlines
  s = s.replace(/\n/g, '<br>');

  return `<p>${s}</p>`;
}
