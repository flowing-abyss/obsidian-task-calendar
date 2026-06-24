import type { App } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../src/parser/types';
import { freshContainer, resolvedConfig, useRealMoment } from './helpers';

useRealMoment();
vi.useFakeTimers();

vi.mock('obsidian', async () => {
  const actual = await vi.importActual<typeof import('obsidian')>('obsidian');
  class MockModal {
    app: App;
    contentEl: HTMLElement;
    containerEl: HTMLElement;
    onSubmit?: (text: string) => Promise<void>;
    constructor(app: App) {
      this.app = app;
      this.containerEl = activeDocument.createElement('div');
      activeDocument.body.appendChild(this.containerEl);
      this.contentEl = this.containerEl.createDiv();
    }
    open(): void {
      this.onOpen();
    }
    close(): void {
      this.onClose();
      this.containerEl.remove();
    }
    onOpen(): void {}
    onClose(): void {}
  }
  return { ...actual, Modal: MockModal };
});

// Import AFTER vi.mock
import type { TaskStore } from '../src/store/TaskStore';
import { CalendarRenderer } from '../src/ui/CalendarRenderer';

class StubStore {
  private tasks: Task[] = [];
  private listeners = new Set<(p: { changedFile?: string }) => void>();
  getTasks(): Task[] {
    return this.tasks;
  }
  onUpdate(cb: (p: { changedFile?: string }) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  emit(changedFile?: string): void {
    for (const l of this.listeners) l({ changedFile });
  }
  setTasks(t: Task[]): void {
    this.tasks = t;
  }
  toggleTask = vi.fn();
  addTask = vi.fn<(date: string, text: string) => Promise<void>>().mockResolvedValue(undefined);
}

function fakeApp(): App {
  return {} as App;
}

describe('CalendarRenderer TaskInputModal submit', () => {
  let store: StubStore;
  let root: HTMLElement;
  let renderer: CalendarRenderer;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new StubStore();
    root = freshContainer();
    renderer = new CalendarRenderer(
      root,
      store as unknown as TaskStore,
      resolvedConfig({ defaultView: 'month' }),
      fakeApp(),
    );
    renderer.mount();
  });

  afterEach(() => {
    renderer.destroy();
    // Clear any modal containers leaked into activeDocument.body between tests
    activeDocument.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('onCellClick opens modal with input + Add button in activeDocument', () => {
    // trigger onCellClick by clicking a current-month cell (not task/cellName)
    const cell = root.querySelector('.cell.currentMonth') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // modal contentEl should be in activeDocument.body
    const input = activeDocument.body.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const addBtn = Array.from(activeDocument.body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Add',
    );
    expect(addBtn).not.toBeNull();
  });

  it('Enter with text → store.addTask(date, trimmedText)', () => {
    const cell = root.querySelector('.cell.currentMonth') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = activeDocument.body.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = '  Buy milk  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.addTask).toHaveBeenCalledTimes(1);
    expect(store.addTask.mock.calls[0]![1]).toBe('Buy milk');
  });

  it('Add button click with text → store.addTask', () => {
    const cell = root.querySelector('.cell.currentMonth') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = activeDocument.body.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'Task via button';
    const addBtn = Array.from(activeDocument.body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Add',
    )!;
    addBtn.click();
    expect(store.addTask).toHaveBeenCalledWith(expect.any(String), 'Task via button');
  });

  it('empty/whitespace input → store.addTask NOT called', () => {
    const cell = root.querySelector('.cell.currentMonth') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = activeDocument.body.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.addTask).not.toHaveBeenCalled();
  });

  it('addTask receives the cell date as first arg', () => {
    const cell = root.querySelector('.cell.currentMonth') as HTMLElement;
    const expectedDate =
      cell.querySelector('.cellName')?.getAttribute('href')?.split('/').pop() ??
      cell.querySelector('.cellName')?.getAttribute('href');
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const input = activeDocument.body.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'test';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.addTask.mock.calls[0]![0]).toBe(expectedDate);
  });
});
