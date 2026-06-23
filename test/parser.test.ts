import { describe, expect, it } from 'vitest';
import { parseTask } from '../src/parser/TaskParser';

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
    expect(t?.priority).toBe('C');
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

  it('parses time and moves to front of text', () => {
    const t = parseTask('- [ ] Meeting ⏰ 14:30 with team', { filePath: 'f.md', line: 0 });
    expect(t?.time).toBe('14:30');
    expect(t?.text).toBe('⏰ 14:30 Meeting with team');
  });

  it('parses recurrence', () => {
    const t = parseTask('- [ ] Standup 🔁 every day', { filePath: 'f.md', line: 0 });
    expect(t?.recurrence).toBe('every day');
    expect(t?.text).not.toContain('🔁');
  });

  it('parses high priority', () => {
    const t = parseTask('- [ ] Urgent task ⏫', { filePath: 'f.md', line: 0 });
    expect(t?.priority).toBe('A');
    expect(t?.text).not.toContain('⏫');
  });

  it('parses medium priority', () => {
    const t = parseTask('- [ ] Medium 🔼', { filePath: 'f.md', line: 0 });
    expect(t?.priority).toBe('B');
  });

  it('parses low priority', () => {
    const t = parseTask('- [ ] Low 🔽', { filePath: 'f.md', line: 0 });
    expect(t?.priority).toBe('D');
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
