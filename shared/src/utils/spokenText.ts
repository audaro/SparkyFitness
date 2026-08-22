/**
 * Converts chat markdown into plain text suitable for text-to-speech.
 * Sparky replies are markdown (headings, bold, lists, tables, emoji
 * checkmarks); read aloud verbatim they sound like line noise. This keeps the
 * words and drops the notation. Pure function so it stays unit-testable.
 */
export function markdownToSpokenText(markdown: string): string {
  let text = markdown;

  // Fenced code blocks: drop entirely (reading code aloud is useless).
  text = text.replace(/```[\s\S]*?```/g, ' ');
  // Inline code: keep the content.
  text = text.replace(/`([^`]*)`/g, '$1');
  // Images: drop; links: keep the label.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Headings, blockquotes, list bullets, numbered-list markers.
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^\s*>\s?/gm, '');
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  // Table rows: turn pipes into pauses; drop separator rows like |---|---|.
  text = text.replace(/^\s*\|?[\s:|-]+\|[\s:|-]+$/gm, ' ');
  text = text.replace(/\|/g, ', ');
  // Emphasis markers (after list handling so leading * isn't eaten twice).
  text = text.replace(/(\*\*|__|\*|_|~~)/g, '');
  // Horizontal rules.
  text = text.replace(/^\s*([-*_]\s*){3,}$/gm, ' ');
  // The server's success convention: a leading ✅ per confirmed action.
  text = text.replace(/[✅❌⚠️]/gu, '');
  // Collapse whitespace runs left behind by the removals.
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\s*\n\s*/g, '\n').trim();

  return text;
}
