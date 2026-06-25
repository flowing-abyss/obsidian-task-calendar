import { WorkspaceLeaf, type App } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/app/AppState';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { TaskStore } from '../src/store/TaskStore';
import { PANEL_VIEW_TYPE, PanelView } from '../src/views/PanelView';
import { createAppWithFiles, flushMicrotasks, seedTaskCache, useRealMoment } from './helpers';

useRealMoment();

describe('PanelView', () => {
  describe('empty vault suite', () => {
    let app: Awaited<ReturnType<typeof createAppWithFiles>>;
    let store: TaskStore;
    let leaf: WorkspaceLeaf;
    let view: PanelView;

    beforeEach(async () => {
      app = await createAppWithFiles({});
      store = new TaskStore(app, DEFAULT_SETTINGS);
      await store.initialize();
      await flushMicrotasks();
      leaf = new (WorkspaceLeaf as unknown as { new (app: App): WorkspaceLeaf })(app);
      view = new PanelView(leaf, store, DEFAULT_SETTINGS);
      await view.onOpen();
    });

    afterEach(async () => {
      await view.onClose();
    });

    it('adds tc-panel-view class to contentEl', () => {
      expect(view.contentEl.classList.contains('tc-panel-view')).toBe(true);
    });

    it('creates tc-layout with 4 zones', () => {
      const layout = view.contentEl.querySelector('.tc-layout');
      expect(layout).not.toBeNull();
      expect(layout?.querySelector('.tc-rail')).not.toBeNull();
      expect(layout?.querySelector('.tc-left')).not.toBeNull();
      expect(layout?.querySelector('.tc-center')).not.toBeNull();
      expect(layout?.querySelector('.tc-right')).not.toBeNull();
    });

    it('tc-rail has 3 rail buttons (tasks/calendar/search) + 1 settings button', () => {
      const railBtns = view.contentEl.querySelectorAll('.tc-rail .tc-rail-btn');
      expect(railBtns).toHaveLength(4);
    });

    it('tc-left shows Inbox / Today / Upcoming smart lists', () => {
      const labels = Array.from(view.contentEl.querySelectorAll('.tc-left .tc-left-label')).map(
        (l) => l.textContent,
      );
      expect(labels).toContain('Inbox');
      expect(labels).toContain('Today');
      expect(labels).toContain('Upcoming');
    });

    it('mode change to calendar updates layout class', () => {
      const state = (view as unknown as { state: AppState }).state;
      const layout = view.contentEl.querySelector('.tc-layout') as HTMLElement;
      const before = layout.className;
      state.set('mode', 'calendar');
      expect(layout.className).not.toBe(before);
      expect(layout.className).toContain('tc-layout--calendar');
    });

    it('store.onUpdate with empty taskStack → no error', () => {
      const state = (view as unknown as { state: AppState }).state;
      state.set('taskStack', []);
      expect(() =>
        (
          store as unknown as { listeners: Array<(e: { changedFile?: string }) => void> }
        ).listeners.forEach((l) => l({ changedFile: 'x.md' })),
      ).not.toThrow();
    });

    it('onClose empties contentEl', async () => {
      await view.onClose();
      expect(view.contentEl.children).toHaveLength(0);
    });

    it('onClose unsubs mode listener (different mode value does not mutate layout)', async () => {
      const state = (view as unknown as { state: AppState }).state;
      const layout = view.contentEl.querySelector('.tc-layout') as HTMLElement;
      const before = layout.className;
      await view.onClose();
      state.set('mode', 'search'); // different value
      expect(layout.className).toBe(before); // listener removed → no change
    });

    it('getViewType returns task-calendar-panel', () => {
      expect(view.getViewType()).toBe(PANEL_VIEW_TYPE);
    });

    it('getDisplayText returns "Task calendar"', () => {
      expect(view.getDisplayText()).toBe('Task calendar');
    });

    it('getIcon returns calendar-days', () => {
      expect(view.getIcon()).toBe('calendar-days');
    });
  });

  describe('populated vault suite', () => {
    let app: Awaited<ReturnType<typeof createAppWithFiles>>;
    let store: TaskStore;
    let leaf: WorkspaceLeaf;
    let view: PanelView;

    beforeEach(async () => {
      app = await createAppWithFiles({
        'today.md': `- [ ] task one 📅 ${window.moment().format('YYYY-MM-DD')}`,
      });
      seedTaskCache(app, 'today.md', [{ task: ' ', parent: -1, line: 0 }]);
      store = new TaskStore(app, DEFAULT_SETTINGS);
      await store.initialize();
      await flushMicrotasks();
      leaf = new (WorkspaceLeaf as unknown as { new (app: App): WorkspaceLeaf })(app);
      view = new PanelView(leaf, store, DEFAULT_SETTINGS);
      await view.onOpen();
    });

    afterEach(async () => {
      await view.onClose();
    });

    it('store.onUpdate matching root task filePath → taskStack replaced with fresh task', () => {
      const state = (view as unknown as { state: AppState }).state;
      const tasks = store.getTasks();
      const root = tasks[0]!;
      state.set('taskStack', [root]);
      // emit onUpdate with matching changedFile
      (
        store as unknown as { listeners: Array<(e: { changedFile?: string }) => void> }
      ).listeners.forEach((l) => l({ changedFile: root.filePath }));
      const stack = state.get('taskStack');
      expect(stack).toHaveLength(1);
      // Direct listener emission does not re-parse the file, so the store returns the
      // same Task reference; the stack array is rebuilt but the root object is unchanged.
      expect((stack[0] as { filePath: string }).filePath).toBe(root.filePath);
    });

    it('store.onUpdate with non-matching changedFile → taskStack unchanged', () => {
      const state = (view as unknown as { state: AppState }).state;
      const root = store.getTasks()[0]!;
      state.set('taskStack', [root]);
      const before = state.get('taskStack');
      (
        store as unknown as { listeners: Array<(e: { changedFile?: string }) => void> }
      ).listeners.forEach((l) => l({ changedFile: 'other.md' }));
      expect(state.get('taskStack')).toBe(before);
    });

    it('store.onUpdate when root task deleted → taskStack reset to []', () => {
      const state = (view as unknown as { state: AppState }).state;
      const root = store.getTasks()[0]!;
      state.set('taskStack', [root]);
      // simulate deletion: temporarily empty the store, emit
      const origTasks = (store as unknown as { taskMap: Map<string, unknown> }).taskMap;
      (store as unknown as { taskMap: Map<string, unknown> }).taskMap = new Map();
      (
        store as unknown as { listeners: Array<(e: { changedFile?: string }) => void> }
      ).listeners.forEach((l) => l({ changedFile: root.filePath }));
      expect(state.get('taskStack')).toHaveLength(0);
      // restore for cleanup
      (store as unknown as { taskMap: Map<string, unknown> }).taskMap = origTasks;
    });

    it('refresh updates left panel count badges after store change (DOM assertion)', async () => {
      // Initial: one open task due today → Today count badge = "1"
      const left = view.contentEl.querySelector('.tc-left') as HTMLElement;
      const todayItem = Array.from(left.querySelectorAll('.tc-left-item')).find(
        (el) => el.querySelector('.tc-left-label')?.textContent === 'Today',
      ) as HTMLElement | undefined;
      expect(todayItem?.querySelector('.tc-left-count')?.textContent).toBe('1');
      // Toggle the task done via file mutation (simulates store refresh)
      const file = app.vault.getMarkdownFiles()[0]!;
      await app.vault.process(file, (data) => data.replace('- [ ]', '- [x]'));
      // Emit store.onUpdate to trigger left.refresh() + center.refresh()
      (
        store as unknown as { listeners: Array<(e: { changedFile?: string }) => void> }
      ).listeners.forEach((l) => l({ changedFile: file.path }));
      await flushMicrotasks();
      // After refresh: no open tasks due today → Today count badge absent (count 0 → not rendered)
      const todayItemAfter = Array.from(left.querySelectorAll('.tc-left-item')).find(
        (el) => el.querySelector('.tc-left-label')?.textContent === 'Today',
      ) as HTMLElement | undefined;
      expect(todayItemAfter?.querySelector('.tc-left-count')?.textContent ?? '0').toBe('0');
    });
  });

  describe('deep-stack rebuild suite', () => {
    let app: Awaited<ReturnType<typeof createAppWithFiles>>;
    let store: TaskStore;
    let leaf: WorkspaceLeaf;
    let view: PanelView;

    beforeEach(async () => {
      app = await createAppWithFiles({
        'tasks.md': `- [ ] parent task 📅 ${window.moment().format('YYYY-MM-DD')}\n  - [ ] subtask one`,
      });
      seedTaskCache(app, 'tasks.md', [
        { task: ' ', parent: -1, line: 0 },
        { task: ' ', parent: 0, line: 1 },
      ]);
      store = new TaskStore(app, DEFAULT_SETTINGS);
      await store.initialize();
      await flushMicrotasks();
      leaf = new (WorkspaceLeaf as unknown as { new (app: App): WorkspaceLeaf })(app);
      view = new PanelView(leaf, store, DEFAULT_SETTINGS);
      await view.onOpen();
    });

    afterEach(async () => {
      await view.onClose();
    });

    it('store.onUpdate with stack.length > 1 rebuilds deep stack with fresh subtask (lines 88-99)', () => {
      const state = (view as unknown as { state: AppState }).state;
      const tasks = store.getTasks();
      const root = tasks[0]!;
      const sub = root.subtasks?.[0];
      expect(sub).toBeDefined();
      // Set a 2-level stack: [root, subtask]
      state.set('taskStack', [root, sub!]);
      // Emit onUpdate with matching changedFile → triggers deep-stack rebuild
      (
        store as unknown as { listeners: Array<(e: { changedFile?: string }) => void> }
      ).listeners.forEach((l) => l({ changedFile: root.filePath }));
      const stack = state.get('taskStack');
      // Stack should still have 2 elements (root + fresh subtask found by line match)
      expect(stack).toHaveLength(2);
      expect((stack[0] as { filePath: string }).filePath).toBe(root.filePath);
      expect((stack[1] as { line: number }).line).toBe(sub!.line);
    });

    it('store.onUpdate with stack.length > 1 and stale subtask line breaks early (truncates stack)', () => {
      const state = (view as unknown as { state: AppState }).state;
      const tasks = store.getTasks();
      const root = tasks[0]!;
      // Create a fake subtask with a line number that doesn't exist in fresh data
      const fakeSub = { ...root.subtasks?.[0]!, line: 999 };
      state.set('taskStack', [root, fakeSub]);
      (
        store as unknown as { listeners: Array<(e: { changedFile?: string }) => void> }
      ).listeners.forEach((l) => l({ changedFile: root.filePath }));
      const stack = state.get('taskStack');
      // Fresh subtask not found at line 999 → break → stack truncated to [freshRoot]
      expect(stack).toHaveLength(1);
    });
  });
});
