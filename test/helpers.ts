// eslint-disable-next-line no-restricted-imports, import/no-extraneous-dependencies
import moment from 'moment';
import { App as ObsidianApp, Platform, TFile, type CachedMetadata } from 'obsidian';
import { afterEach, beforeEach } from 'vitest';
import type { Task } from '../src/parser/types';

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
