import { markdownToSpokenText } from '@workspace/shared';

describe('markdownToSpokenText', () => {
  it('passes plain text through unchanged', () => {
    expect(markdownToSpokenText('You have 1,450 calories left today.')).toBe(
      'You have 1,450 calories left today.'
    );
  });

  it('strips emphasis, headings, and list markers but keeps the words', () => {
    const md = '## Today\n**Breakfast** was *good*:\n- 2 eggs\n- 1 toast\n1. water';
    expect(markdownToSpokenText(md)).toBe('Today\nBreakfast was good:\n2 eggs\n1 toast\nwater');
  });

  it('drops the server checkmark convention and code blocks', () => {
    const md = '✅ Logged 2 eggs\n```json\n{"internal": true}\n```\nAll set!';
    const spoken = markdownToSpokenText(md);
    expect(spoken).toContain('Logged 2 eggs');
    expect(spoken).toContain('All set!');
    expect(spoken).not.toContain('✅');
    expect(spoken).not.toContain('internal');
  });

  it('keeps link labels and inline code content', () => {
    expect(markdownToSpokenText('See [your report](https://x.example) and `protein`.')).toBe(
      'See your report and protein.'
    );
  });

  it('reads table cells as pauses and drops separator rows', () => {
    const md = '| Meal | Calories |\n|---|---|\n| Lunch | 640 |';
    const spoken = markdownToSpokenText(md);
    expect(spoken).toContain('Meal');
    expect(spoken).toContain('Lunch');
    expect(spoken).not.toContain('|');
    expect(spoken).not.toContain('---');
  });

  it('returns an empty string when nothing speakable remains', () => {
    expect(markdownToSpokenText('```\ncode only\n```')).toBe('');
  });
});
