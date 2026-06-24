import { describe, expect, it } from 'vitest';
import { formatTaskLine, parseTask } from '../src/parser/TaskParser';

describe('parseTask', () => {
  it('returns null for non-task lines', () => {
    expect(parseTask('- just a list item', { filePath: 'f.md', line: 0 })).toBeNull();
    expect(parseTask('# heading', { filePath: 'f.md', line: 0 })).toBeNull();
    expect(parseTask('plain text', { filePath: 'f.md', line: 0 })).toBeNull();
    expect(parseTask('', { filePath: 'f.md', line: 0 })).toBeNull();
  });

  it('parses open task', () => {
    const t = parseTask('- [ ] Do something', { filePath: 'f.md', line: 5 });
    expect(t).not.toBeNull();
    expect(t?.status).toBe('open');
    expect(t?.text).toBe('Do something');
    expect(t?.line).toBe(5);
    expect(t?.priority).toBe('D');
  });

  it('parses done task', () => {
    const t = parseTask('- [x] Done task ✅ 2026-06-22', { filePath: 'f.md', line: 0 });
    expect(t?.status).toBe('done');
    expect(t?.completion).toBe('2026-06-22');
    expect(t?.text).not.toContain('✅');
  });

  it('parses done task with capital X', () => {
    const t = parseTask('- [X] Done', { filePath: 'f.md', line: 0 });
    expect(t?.status).toBe('done');
  });

  it('parses cancelled task via checkbox char', () => {
    const t = parseTask('- [-] Cancelled task', { filePath: 'f.md', line: 0 });
    expect(t?.status).toBe('cancelled');
  });

  it('parses in-progress task via checkbox char', () => {
    const t = parseTask('- [/] In progress', { filePath: 'f.md', line: 0 });
    expect(t?.status).toBe('in-progress');
  });

  it('parses due date and removes from text', () => {
    const t = parseTask('- [ ] Buy groceries 📅 2026-07-01', { filePath: 'f.md', line: 0 });
    expect(t?.due).toBe('2026-07-01');
    expect(t?.text).toBe('Buy groceries');
  });

  it('parses scheduled date', () => {
    const t = parseTask('- [ ] Review PR ⏳ 2026-06-25', { filePath: 'f.md', line: 0 });
    expect(t?.scheduled).toBe('2026-06-25');
    expect(t?.text).toBe('Review PR');
  });

  it('parses start date', () => {
    const t = parseTask('- [ ] Long task 🛫 2026-06-20 📅 2026-06-30', {
      filePath: 'f.md',
      line: 0,
    });
    expect(t?.start).toBe('2026-06-20');
    expect(t?.due).toBe('2026-06-30');
  });

  it('parses completion date', () => {
    const t = parseTask('- [x] Done ✅ 2026-06-01', { filePath: 'f.md', line: 0 });
    expect(t?.completion).toBe('2026-06-01');
  });

  it('parses cancelled emoji and sets status', () => {
    const t = parseTask('- [ ] Dropped ❌ 2026-06-10', { filePath: 'f.md', line: 0 });
    expect(t?.status).toBe('cancelled');
    expect(t?.cancelledDate).toBe('2026-06-10');
  });

  it('parses time and strips it from display text', () => {
    const t = parseTask('- [ ] Meeting ⏰ 14:30 with team', { filePath: 'f.md', line: 0 });
    expect(t?.time).toBe('14:30');
    expect(t?.text).toBe('Meeting with team');
  });

  it('parses recurrence', () => {
    const t = parseTask('- [ ] Standup 🔁 every day', { filePath: 'f.md', line: 0 });
    expect(t?.recurrence).toBe('every day');
    expect(t?.text).not.toContain('🔁');
  });

  it('parses highest priority (🔺)', () => {
    const t = parseTask('- [ ] Urgent task 🔺', { filePath: 'f.md', line: 0 });
    expect(t?.priority).toBe('A');
    expect(t?.text).not.toContain('🔺');
  });

  it('parses high priority (⏫)', () => {
    const t = parseTask('- [ ] Urgent task ⏫', { filePath: 'f.md', line: 0 });
    expect(t?.priority).toBe('B');
    expect(t?.text).not.toContain('⏫');
  });

  it('parses medium priority (🔼)', () => {
    const t = parseTask('- [ ] Medium 🔼', { filePath: 'f.md', line: 0 });
    expect(t?.priority).toBe('C');
  });

  it('parses low priority (🔽)', () => {
    const t = parseTask('- [ ] Low 🔽', { filePath: 'f.md', line: 0 });
    expect(t?.priority).toBe('E');
  });

  it('parses lowest priority (⏬)', () => {
    const t = parseTask('- [ ] Lowest ⏬', { filePath: 'f.md', line: 0 });
    expect(t?.priority).toBe('F');
    expect(t?.text).not.toContain('⏬');
  });

  it('collapses wikilink with alias', () => {
    const t = parseTask('- [ ] See [[My Note|alias]]', { filePath: 'f.md', line: 0 });
    expect(t?.text).toContain('🔗My Note');
    expect(t?.text).not.toContain('[[');
  });

  it('collapses plain wikilink', () => {
    const t = parseTask('- [ ] See [[My Note]]', { filePath: 'f.md', line: 0 });
    expect(t?.text).toContain('🔗 My Note');
  });

  it('collapses markdown link', () => {
    const t = parseTask('- [ ] See [Google](https://google.com)', { filePath: 'f.md', line: 0 });
    expect(t?.text).toContain('🌐 Google');
    expect(t?.text).not.toContain('https://');
  });

  it('strips globalTaskFilter tag', () => {
    const t = parseTask('- [ ] #task/one-off Buy milk', {
      filePath: 'f.md',
      line: 0,
      globalTaskFilter: '#task/one-off',
    });
    expect(t?.text).toBe('Buy milk');
    expect(t?.text).not.toContain('#task/one-off');
  });

  it('strips all other hashtags', () => {
    const t = parseTask('- [ ] Buy #shopping milk', { filePath: 'f.md', line: 0 });
    expect(t?.text).toBe('Buy milk');
  });

  it('preserves dailyNoteDate from context', () => {
    const t = parseTask('- [ ] Something', {
      filePath: 'periodic/daily/2026-06-22.md',
      line: 0,
      dailyNoteDate: '2026-06-22',
    });
    expect(t?.dailyNoteDate).toBe('2026-06-22');
  });

  it('preserves rawText unchanged', () => {
    const raw = '- [ ] Task with 📅 2026-07-01 metadata';
    const t = parseTask(raw, { filePath: 'f.md', line: 0 });
    expect(t?.rawText).toBe(raw);
  });

  it('handles indented tasks', () => {
    const t = parseTask('  - [ ] Indented subtask', { filePath: 'f.md', line: 0 });
    expect(t).not.toBeNull();
    expect(t?.text).toBe('Indented subtask');
  });
});

describe('formatTaskLine', () => {
  it('returns non-task lines unchanged', () => {
    expect(formatTaskLine('- plain list item')).toBe('- plain list item');
    expect(formatTaskLine('# heading')).toBe('# heading');
  });

  it('leaves already-canonical line unchanged', () => {
    const line = '- [ ] Buy milk #shopping ⏰ 09:00 ⏫ 🔁 every day 🛫 2026-01-01 ⏳ 2026-01-10 📅 2026-01-20 ❌ 2026-01-21 ✅ 2026-01-22';
    expect(formatTaskLine(line)).toBe(line);
  });

  it('reorders emojis into canonical Tasks order', () => {
    const input = '- [ ] Task 📅 2026-07-01 ⏫ ⏳ 2026-06-25 🛫 2026-06-20';
    const result = formatTaskLine(input);
    expect(result).toBe('- [ ] Task ⏫ 🛫 2026-06-20 ⏳ 2026-06-25 📅 2026-07-01');
  });

  it('places ⏰ before all other metadata', () => {
    const input = '- [ ] Meeting 📅 2026-07-01 ⏰ 09:30';
    expect(formatTaskLine(input)).toBe('- [ ] Meeting ⏰ 09:30 📅 2026-07-01');
  });

  it('moves tags before emoji metadata', () => {
    const input = '- [ ] Task 📅 2026-07-01 #work #urgent';
    expect(formatTaskLine(input)).toBe('- [ ] Task #work #urgent 📅 2026-07-01');
  });

  it('preserves created date (➕) between recurrence and start date', () => {
    const input = '- [ ] Task ➕ 2026-01-01 🛫 2026-01-05 📅 2026-01-10';
    expect(formatTaskLine(input)).toBe('- [ ] Task ➕ 2026-01-01 🛫 2026-01-05 📅 2026-01-10');
  });

  it('handles recurrence with text', () => {
    const input = '- [ ] Standup 📅 2026-07-01 🔁 every weekday';
    expect(formatTaskLine(input)).toBe('- [ ] Standup 🔁 every weekday 📅 2026-07-01');
  });

  it('is idempotent', () => {
    const input = '- [ ] Task 📅 2026-07-01 ⏫ #work ⏰ 09:00 🔁 every day 🛫 2026-06-20';
    const once = formatTaskLine(input);
    expect(formatTaskLine(once)).toBe(once);
  });

  it('preserves indentation and checkbox state', () => {
    const input = '  - [x] Done task 📅 2026-07-01 ✅ 2026-07-01';
    expect(formatTaskLine(input)).toBe('  - [x] Done task 📅 2026-07-01 ✅ 2026-07-01');
  });

  it('handles all five priority levels', () => {
    expect(formatTaskLine('- [ ] Task ⏬ 📅 2026-07-01')).toBe('- [ ] Task ⏬ 📅 2026-07-01');
    expect(formatTaskLine('- [ ] Task 🔺 📅 2026-07-01')).toBe('- [ ] Task 🔺 📅 2026-07-01');
  });
});
