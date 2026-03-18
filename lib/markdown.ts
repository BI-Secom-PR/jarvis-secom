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

  // Links
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank">$1</a>'
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
