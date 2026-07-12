// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import moment from 'moment';
import { TFile, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import { CenterPanel } from '../src/panels/CenterPanel';
import type { Task } from '../src/parser/types';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { TaskStore } from '../src/store/TaskStore';
import { TagManager } from '../src/tags/TagManager';
import { createAppWithFiles, makeStubStore, task, useRealMoment } from './helpers';

useRealMoment();

async function readMd(app: App, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) throw new Error(`${path} is not a TFile`);
  return app.vault.cachedRead(f);
}

function callPrivate<T>(panel: CenterPanel, method: string, ...args: unknown[]): T {
  const fn = (panel as unknown as Record<string, (...a: unknown[]) => T>)[method]!;
  return fn.call(panel, ...args);
}

async function makePanel(
  files: Record<string, string>,
  extraTasks: Task[] = [],
): Promise<{ panel: CenterPanel; app: App }> {
  const app = await createAppWithFiles(files);
  const state = new AppState();
  const save = vi.fn().mockResolvedValue(undefined);
  const tm = new TagManager(null as never, DEFAULT_SETTINGS, save);
  const store = makeStubStore(extraTasks, app) as unknown as TaskStore;
  const panel = new CenterPanel(state, store, app, DEFAULT_SETTINGS, tm);
  return { panel, app };
}

describe('CenterPanel.toggleDueToday', () => {
  it('sets due date when task has no due', async () => {
    const today = moment().format('YYYY-MM-DD');
    const { panel, app } = await makePanel({ 'n.md': '- [ ] Buy milk\n' });
    const t = task({ filePath: 'n.md', line: 0, rawText: '- [ ] Buy milk', due: undefined });
    await callPrivate(panel, 'toggleDueToday', t);
    const content = await readMd(app, 'n.md');
    expect(content).toContain(`📅 ${today}`);
  });

  it('clears due date when task already has today as due', async () => {
    const today = moment().format('YYYY-MM-DD');
    const raw = `- [ ] Buy milk 📅 ${today}`;
    const { panel, app } = await makePanel({ 'n.md': `${raw}\n` });
    const t = task({ filePath: 'n.md', line: 0, rawText: raw, due: today });
    await callPrivate(panel, 'toggleDueToday', t);
    const content = await readMd(app, 'n.md');
    expect(content).not.toMatch(/📅\s*\d{4}-\d{2}-\d{2}/u);
  });

  it('replaces existing non-today due date with today', async () => {
    const today = moment().format('YYYY-MM-DD');
    const raw = '- [ ] Buy milk 📅 2020-01-01';
    const { panel, app } = await makePanel({ 'n.md': `${raw}\n` });
    const t = task({ filePath: 'n.md', line: 0, rawText: raw, due: '2020-01-01' });
    await callPrivate(panel, 'toggleDueToday', t);
    const content = await readMd(app, 'n.md');
    expect(content).toContain(`📅 ${today}`);
    expect(content).not.toContain('2020-01-01');
  });
});

describe('CenterPanel.setPriority', () => {
  it('adds priority emoji when task has none', async () => {
    const { panel, app } = await makePanel({ 'n.md': '- [ ] Task\n' });
    const t = task({ filePath: 'n.md', line: 0, rawText: '- [ ] Task', priority: 'D' });
    await callPrivate(panel, 'setPriority', t, 'A');
    const content = await readMd(app, 'n.md');
    expect(content).toContain('🔺');
  });

  it('removes all priority emojis when D (normal) is selected', async () => {
    const raw = '- [ ] Task 🔺';
    const { panel, app } = await makePanel({ 'n.md': `${raw}\n` });
    const t = task({ filePath: 'n.md', line: 0, rawText: raw, priority: 'A' });
    await callPrivate(panel, 'setPriority', t, 'D');
    const content = await readMd(app, 'n.md');
    expect(content).not.toMatch(/[🔺⏫🔼🔽⏬]/u);
  });

  it('replaces existing priority with new one', async () => {
    const raw = '- [ ] Task ⏫';
    const { panel, app } = await makePanel({ 'n.md': `${raw}\n` });
    const t = task({ filePath: 'n.md', line: 0, rawText: raw, priority: 'B' });
    await callPrivate(panel, 'setPriority', t, 'C');
    const content = await readMd(app, 'n.md');
    expect(content).toContain('🔼');
    expect(content).not.toContain('⏫');
  });
});

describe('CenterPanel.rescheduleTask anchor priority', () => {
  it('moves scheduled date when both scheduled and due are set (scheduled wins)', async () => {
    const raw = '- [ ] t ⏳ 2026-07-02 📅 2026-07-10';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      scheduled: '2026-07-02',
      due: '2026-07-10',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'rescheduleTask', 'f.md:::0', '2026-07-03');
    const content = await readMd(app, 'f.md');
    expect(content).toContain('⏳ 2026-07-03');
    expect(content).toContain('📅 2026-07-10'); // due untouched
  });

  it('moves due date when only due is set', async () => {
    const raw = '- [ ] t 📅 2026-07-10';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      due: '2026-07-10',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'rescheduleTask', 'f.md:::0', '2026-07-11');
    const content = await readMd(app, 'f.md');
    expect(content).toContain('📅 2026-07-11');
  });

  it('adds a new due date when neither is set', async () => {
    const raw = '- [ ] t';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'rescheduleTask', 'f.md:::0', '2026-07-12');
    const content = await readMd(app, 'f.md');
    expect(content).toContain('📅 2026-07-12');
  });
});

describe('CenterPanel.extendTaskToSpan', () => {
  it('freezes the original due as the new start and writes the new due, in one mutation', async () => {
    const raw = '- [ ] t 📅 2026-07-10';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      due: '2026-07-10',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'extendTaskToSpan', t, '2026-07-12');
    const content = await readMd(app, 'f.md');
    expect(content).toContain('🛫 2026-07-10');
    expect(content).toContain('📅 2026-07-12');
    expect(content).not.toContain('📅 2026-07-10');
  });

  it('extends a scheduled-only task (Bug A regression: used to silently no-op since it required task.due)', async () => {
    const raw = '- [ ] t ⏳ 2026-07-10';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      scheduled: '2026-07-10',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'extendTaskToSpan', t, '2026-07-12');
    const content = await readMd(app, 'f.md');
    // The original scheduled anchor freezes as start; the new date is written as due (a
    // due-centric span is always anchored by `due` once created — see bucketTasksForDate).
    expect(content).toContain('🛫 2026-07-10');
    expect(content).toContain('📅 2026-07-12');
    expect(content).toContain('⏳ 2026-07-10'); // scheduled itself stays untouched
  });

  it('freezes `scheduled` (not `due`) as the new start for a "deadline" task with distinct scheduled+due, keeping the resulting span non-reversed', async () => {
    // Interactive-CLI-verified regression: an earlier version of this fix froze `due` as start
    // here (`task.due ?? task.scheduled`), which — combined with the keyboard handler's own
    // scheduled-first date computation (Bug B fix) — produced an invalid reversed span (start
    // AFTER due) for exactly this task shape. `task.scheduled ?? task.due` (matching
    // bucketTasksForDate's own anchor priority) keeps the frozen start consistent with whichever
    // date the caller actually computed the new due from.
    const raw = '- [ ] t ⏳ 2026-07-12 📅 2026-07-17';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      scheduled: '2026-07-12',
      due: '2026-07-17',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'extendTaskToSpan', t, '2026-07-13');
    const content = await readMd(app, 'f.md');
    expect(content).toContain('🛫 2026-07-12');
    expect(content).toContain('📅 2026-07-13');
    expect(content).not.toContain('📅 2026-07-17');
    expect(content).toContain('⏳ 2026-07-12'); // scheduled itself stays untouched
  });

  it('re-extending an already-spanning task does not append a second 🛫 token', async () => {
    const raw = '- [ ] t 🛫 2026-07-08 📅 2026-07-10';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      start: '2026-07-08',
      due: '2026-07-10',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'extendTaskToSpan', t, '2026-07-12');
    const content = await readMd(app, 'f.md');
    expect(content.match(/🛫/gu)).toHaveLength(1);
    expect(content).toContain('🛫 2026-07-08');
    expect(content).toContain('📅 2026-07-12');
  });
});

describe('CenterPanel.updateTaskStart — Task 34 left-edge drag on a timed block', () => {
  // `updateTaskStart` is the SAME private method Task 9's all-day span left-edge already drives
  // (see CenterPanel's handleStartChange, wired to both AllDayCallbacks.onStartChange and, as of
  // Task 34, TimedBlockCallbacks.onStartChange) — this suite exercises it via the timed-block
  // call path specifically, confirming the reuse doesn't need its own bespoke mutation and that
  // it goes through the same `applyValidatedLineMutation` safety net as every other drag-driven
  // mutation in this file.
  it('appends a fresh 🛫 start when the task (a due+time-only deadline) has none yet, leaving 📅/⏰/⏱️ untouched', async () => {
    const raw = '- [ ] t ⏰ 09:00 ⏱️ 1h 📅 2026-07-10';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      time: '09:00',
      duration: 60,
      due: '2026-07-10',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'updateTaskStart', t, '2026-07-08');
    const content = await readMd(app, 'f.md');
    expect(content).toContain('🛫 2026-07-08');
    expect(content).toContain('📅 2026-07-10');
    expect(content).toContain('⏰ 09:00');
    expect(content).toContain('⏱️ 1h');
  });

  it('moves an existing 🛫 start directly (does not append a second one), leaving due/time/duration untouched', async () => {
    const raw = '- [ ] t 🛫 2026-07-08 ⏰ 09:00 ⏱️ 1h 📅 2026-07-10';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      start: '2026-07-08',
      time: '09:00',
      duration: 60,
      due: '2026-07-10',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'updateTaskStart', t, '2026-07-06');
    const content = await readMd(app, 'f.md');
    expect(content.match(/🛫/gu)).toHaveLength(1);
    expect(content).toContain('🛫 2026-07-06');
    expect(content).not.toContain('🛫 2026-07-08');
    expect(content).toContain('📅 2026-07-10');
    expect(content).toContain('⏰ 09:00');
  });

  it('routes through the applyValidatedLineMutation safety net: a candidate that would corrupt the line is rejected, leaving the original line completely untouched', async () => {
    const raw = '- [ ] t ⏰ 09:00 📅 2026-07-10';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      time: '09:00',
      due: '2026-07-10',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    // Not a real day-column-resolved date (those are always well-formed YYYY-MM-DD), but the
    // safety net validates the resulting line regardless of caller — this proves the same
    // guard Task 33 hardened for updateTaskTime/updateTaskDuration also covers this new
    // left-edge-drag call path, not just those two methods.
    await callPrivate(panel, 'updateTaskStart', t, 'not-a-date');
    const content = await readMd(app, 'f.md');
    expect(content).toBe(`${raw}\n`);
    expect(content).not.toContain('not-a-date');
  });

  it("Task 51 regression: dragging the left edge past the block's own due date is rejected, leaving the file byte-for-byte unchanged (mirrors the Task 49 right-edge fix)", async () => {
    // Interactive-CLI-confirmed repro: a 3-day span (🛫 2026-07-13 📅 2026-07-15 ⏰13:00
    // ⏱️1h), dragging the LEFT span-edge handle right by one day-column resolved (via
    // elementFromPoint's absolute "day under the cursor" logic, not a delta from the
    // original start) to 2026-07-16 — AFTER the task's own due (2026-07-15) — producing an
    // inverted span that silently vanished from every calendar view once written.
    const raw = '- [ ] Drag test alpha 🛫 2026-07-13 📅 2026-07-15 ⏰13:00 ⏱️1h';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      start: '2026-07-13',
      due: '2026-07-15',
      time: '13:00',
      duration: 60,
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'updateTaskStart', t, '2026-07-16');
    const content = await readMd(app, 'f.md');
    expect(content).toBe(`${raw}\n`);
    expect(content).not.toContain('🛫 2026-07-16');
  });

  it('Task 51: same-day start === due is still accepted (not treated as inverted)', async () => {
    const raw = '- [ ] t 🛫 2026-07-13 📅 2026-07-15 ⏰13:00 ⏱️1h';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      start: '2026-07-13',
      due: '2026-07-15',
      time: '13:00',
      duration: 60,
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'updateTaskStart', t, '2026-07-15');
    const content = await readMd(app, 'f.md');
    expect(content).toContain('🛫 2026-07-15');
    expect(content).toContain('📅 2026-07-15');
  });
});

describe('CenterPanel.setTaskTimeFromDrop', () => {
  it('adds both a new due date and a new time when neither is set (plain task dropped into hour grid)', async () => {
    const raw = '- [ ] t';
    const t = task({ filePath: 'f.md', line: 0, rawText: raw });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'setTaskTimeFromDrop', 'f.md:::0', '2026-07-12', '14:30');
    const content = await readMd(app, 'f.md');
    expect(content).toContain('📅 2026-07-12');
    expect(content).toContain('⏰ 14:30');
  });

  it('writes the scheduled date (not due) when the task already has a scheduled date (scheduled wins)', async () => {
    const raw = '- [ ] t ⏳ 2026-07-02';
    const t = task({ filePath: 'f.md', line: 0, rawText: raw, scheduled: '2026-07-02' });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'setTaskTimeFromDrop', 'f.md:::0', '2026-07-03', '09:00');
    const content = await readMd(app, 'f.md');
    expect(content).toContain('⏳ 2026-07-03');
    expect(content).toContain('⏰ 09:00');
  });

  it('replaces an existing time rather than duplicating the emoji', async () => {
    const raw = '- [ ] t 📅 2026-07-10 ⏰ 09:00';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      due: '2026-07-10',
      time: '09:00',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);
    await callPrivate(panel, 'setTaskTimeFromDrop', 'f.md:::0', '2026-07-10', '16:45');
    const content = await readMd(app, 'f.md');
    expect(content).toContain('⏰ 16:45');
    expect(content).not.toContain('⏰ 09:00');
    const matches = content.match(/⏰/gu);
    expect(matches).toHaveLength(1);
  });
});

describe('CenterPanel.updateTaskTime — Task 33 data-safety net (the disappearing-task regression)', () => {
  // This is the exact scenario reproduced live via Obsidian CLI: a Pointer-Events drag on a
  // timed block's body computed newStartMinutes = 2093*60+15 (an extreme delta — the pointer was
  // released far outside the visible grid). Before this task's fix, `updateTaskTime` wrote
  // "⏰ 2093:15" straight to the file: `formatTaskLine`'s own `\d{1,2}` time-token grammar cannot
  // match a 3-digit hour, so the token failed to round-trip on the very next parse — `time` came
  // back `undefined`, the task silently dropped out of `tasksWithTime` in every Day/Week view,
  // and the garbage "⏰ 2093:15" text leaked into the visible title instead of being stripped as
  // metadata. This test drives `updateTaskTime` with that exact out-of-range minute value
  // directly (bypassing the drag-gesture clamp added in renderTimedBlocks.ts, so this test would
  // still catch a regression even if that clamp were ever removed/loosened) and asserts the
  // mutation-service safety net rejects the write outright: the original line must be preserved
  // byte-for-byte, and the task must still be present, valid, and correctly timed afterward.
  it('rejects an out-of-range minutes value that would corrupt the ⏰ token, leaving the original line completely untouched', async () => {
    const raw = '- [ ] Drag test alpha ⏰ 10:00 ⏱️ 1h 📅 2026-07-11';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      time: '10:00',
      duration: 60,
      due: '2026-07-11',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);

    await callPrivate(panel, 'updateTaskTime', t, 2093 * 60 + 15);

    const content = await readMd(app, 'f.md');
    expect(content).toBe(`${raw}\n`);
    expect(content).toContain('⏰ 10:00');
    expect(content).not.toContain('2093');
  });

  it('still accepts an ordinary, in-range time change (the safety net does not over-reject valid drags)', async () => {
    const raw = '- [ ] Drag test alpha ⏰ 10:00 ⏱️ 1h 📅 2026-07-11';
    const t = task({
      filePath: 'f.md',
      line: 0,
      rawText: raw,
      time: '10:00',
      duration: 60,
      due: '2026-07-11',
    });
    const { panel, app } = await makePanel({ 'f.md': `${raw}\n` }, [t]);

    await callPrivate(panel, 'updateTaskTime', t, 11 * 60 + 30);

    const content = await readMd(app, 'f.md');
    expect(content).toContain('⏰ 11:30');
    expect(content).not.toContain('⏰ 10:00');
  });
});
