// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import moment from 'moment';
import { App as ObsidianApp, Platform, TFile, type CachedMetadata } from 'obsidian';
import { afterEach, beforeEach, vi } from 'vitest';
import type { Task } from '../src/parser/types';
import { DEFAULT_VIEW_CONFIG } from '../src/settings/defaults';
import type { ResolvedConfig } from '../src/settings/types';

/** Install real moment as window.moment for date-aware tests. Idempotent; restores in afterEach. */
export function useRealMoment(): void {
  let prev: unknown;
  beforeEach(() => {
    prev = (window as unknown as { moment?: unknown }).moment;
    (window as unknown as { moment?: unknown }).moment = moment;
  });
  afterEach(() => {
    (window as unknown as { moment?: unknown }).moment = prev;
  });
}

/** Toggle Platform.isMobile for a block; restores previous value in afterEach. */
export function withMobile(value: boolean): void {
  let prev: boolean;
  beforeEach(() => {
    prev = Platform.isMobile;
    (Platform as unknown as { isMobile: boolean }).isMobile = value;
  });
  afterEach(() => {
    (Platform as unknown as { isMobile: boolean }).isMobile = prev;
  });
}

/** Build a minimal Task satisfying the Task type; overrides win. */
export function task(overrides: Partial<Task> = {}): Task {
  return {
    filePath: 'f.md',
    line: 0,
    rawText: '- [ ] t',
    text: 't',
    status: 'open',
    priority: 'D',
    ...overrides,
  };
}

/** Create a fresh App with pre-populated files and flushed async metadata parsing. */
export async function createAppWithFiles(files: Record<string, string>): Promise<ObsidianApp> {
  const app = (
    ObsidianApp as unknown as {
      createConfigured__: (params: { files: Record<string, string> }) => ObsidianApp;
    }
  ).createConfigured__({ files });
  // Flush the mock's async parseFileMetadata for each file
  await Promise.all(app.vault.getMarkdownFiles().map((f) => app.vault.cachedRead(f)));
  await flushMicrotasks();
  return app;
}

/** Wait for the mock's async metadata parsing to settle. */
export async function flushMicrotasks(ms = 10): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Seed a file's metadata cache with task listItems + optional frontmatter (parent=-1 for root items). */
export function seedTaskCache(
  app: ObsidianApp,
  path: string,
  items: Array<{ task: string; parent: number; line: number }>,
  frontmatter?: Record<string, unknown>,
): void {
  const cache = {
    listItems: items.map((i) => ({
      task: i.task,
      parent: i.parent,
      // Only `start.line` is read by TaskStore; col/offset included for shape completeness.
      position: {
        start: { line: i.line, col: 0, offset: 0 },
        end: { line: i.line, col: 80, offset: 80 },
      },
    })),
    ...(frontmatter ? { frontmatter } : {}),
  };
  (
    app.metadataCache as unknown as { setCache__: (path: string, cache: unknown) => void }
  ).setCache__(path, cache);
}

/**
 * Capture the `changed` callback TaskStore registers on metadataCache, so tests can invoke it
 * directly with a crafted (TFile, content, CachedMetadata). Needed because setCache__ fires
 * `changed` with zero args (which would crash the handler). Call BEFORE new TaskStore().initialize()
 * so registerEvents's metadataCache.on('changed', cb) is captured.
 */
export function captureChangedCallback(
  app: ObsidianApp,
): (file: TFile, content: string, cache: CachedMetadata) => void {
  let captured: ((file: TFile, content: string, cache: CachedMetadata) => void) | null = null;
  const origOn = app.metadataCache.on.bind(app.metadataCache) as (
    name: string,
    cb: (...args: unknown[]) => void,
  ) => unknown;
  app.metadataCache.on = ((name: string, cb: (...args: unknown[]) => void) => {
    if (name === 'changed') {
      captured = cb;
    }
    return origOn(name, cb);
  }) as typeof app.metadataCache.on;
  return (file: TFile, content: string, cache: CachedMetadata) => {
    if (!captured) throw new Error('captureChangedCallback: no changed handler registered');
    captured(file, content, cache);
  };
}

/** Build a full ResolvedConfig with sane defaults; overrides win. */
export function resolvedConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    ...DEFAULT_VIEW_CONFIG,
    isMobile: false,
    ...overrides,
  };
}

/**
 * Minimal DataTransfer shim — jsdom does not define DataTransfer.
 */
export class DataTransferStub {
  private store = new Map<string, string>();
  setData(format: string, data: string): void {
    this.store.set(format, data);
  }
  getData(format: string): string {
    return this.store.get(format) ?? '';
  }
  clearData(format?: string): void {
    if (format) this.store.delete(format);
    else this.store.clear();
  }
  get dropEffect(): string {
    return 'move';
  }
  set dropEffect(_: string) {
    /* no-op */
  }
  get effectAllowed(): string {
    return 'move';
  }
  set effectAllowed(_: string) {
    /* no-op */
  }
  get types(): string[] {
    return [...this.store.keys()];
  }
  get items(): never[] {
    return [];
  }
  get files(): never[] {
    return [];
  }
}

/**
 * Dispatch a DOM DnD event with DataTransfer support.
 * jsdom lacks DragEvent; use MouseEvent (its superclass) + defineProperty.
 */
export function dispatchDnD(
  el: HTMLElement,
  type: 'dragstart' | 'dragover' | 'dragleave' | 'drop' | 'dragend',
  payload?: string,
  relatedTarget: Node | null = null,
): void {
  const dt = new DataTransferStub();
  if (payload !== undefined) dt.setData('text/plain', payload);
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget });
  Object.defineProperty(ev, 'dataTransfer', { value: dt, configurable: true });
  el.dispatchEvent(ev);
}

/** Fresh detached div for view render tests. */
export function freshContainer(): HTMLElement {
  return activeDocument.createElement('div');
}

/**
 * Minimal TaskStore stub exposing getTasks() (with optional tag/status filtering)
 * for panels that read tasks. Cast to TaskStore via `as unknown as TaskStore`.
 */
export function makeStubStore(tasks: Task[]): unknown {
  return {
    getTasks: (filter?: { tag?: string; status?: string[] }): Task[] => {
      let all = tasks;
      if (filter?.tag) all = all.filter((t) => t.rawText.includes(filter.tag!));
      if (filter?.status?.length) all = all.filter((t) => filter.status!.includes(t.status));
      return all;
    },
  };
}

/**
 * Freeze window.moment to a known date for deterministic date-dependent tests.
 * Uses fake timers + the real moment module (which reads system time via Date).
 * Restores real timers in afterEach.
 */
export function fixedToday(dateStr: string): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(dateStr + 'T12:00:00Z'));
    (window as unknown as { moment: unknown }).moment = moment;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
