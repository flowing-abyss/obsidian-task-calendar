import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

const FINAL_CONSUMERS = [
  'src/main.ts',
  'src/code-block/registerCodeBlock.ts',
  'src/settings/SettingsTab.ts',
  'src/projects/ProjectStore.ts',
  'src/views/PanelView.ts',
  'src/panels/CenterPanel.ts',
  'src/panels/LeftPanel.ts',
  'src/panels/RightPanel.ts',
  'src/ui/CalendarRenderer.ts',
  'src/ui/TaskModal.ts',
] as const;

const LEGACY_TESTS = [
  'test/task-store.test.ts',
  'test/task-store-deep.test.ts',
  'test/task-store-notice.test.ts',
  'test/task-date-index.test.ts',
  'test/blockquote-tasks.test.ts',
  'test/panel-view.test.ts',
  'test/register-code-block-deep.test.ts',
  'test/center-panel-integration.test.ts',
] as const;

const RETAINED_COMPATIBILITY_FILES = new Set([
  'src/store/TaskStore.ts',
  'src/store/TaskDateIndex.ts',
  'src/tasks/compat/legacyTaskView.ts',
]);

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function matchingFiles(paths: readonly string[], pattern: RegExp): string[] {
  return paths.filter((path) => pattern.test(source(path)));
}

function typeScriptFiles(directory: string): string[] {
  return readdirSync(resolve(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return typeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('final task consumer contract', () => {
  const productionFiles = typeScriptFiles('src');
  const productionConsumers = productionFiles.filter(
    (path) => !RETAINED_COMPATIBILITY_FILES.has(path),
  );
  const presentationConsumers = productionConsumers.filter((path) =>
    /^(?:src\/main\.ts|src\/(?:app|code-block|domain|panels|projects|settings|ui|views)\/)/u.test(
      path,
    ),
  );
  const taskMutationConsumers = presentationConsumers.filter(
    (path) =>
      /^(?:src\/main\.ts|src\/(?:code-block|panels|ui|views)\/)/u.test(path) ||
      path === 'src/settings/SettingsTab.ts' ||
      path === 'src/projects/ProjectStore.ts',
  );

  it('routes every production source outside the retained compatibility boundary through final task contracts', () => {
    const forbidden =
      /(?:store\/TaskStore|store\/TaskDateIndex|tasks\/compat\/legacyTaskView|plugin\.store|\bTaskStore\b)/u;

    expect(matchingFiles(productionConsumers, forbidden)).toEqual([]);
  });

  it('keeps applicable presentation consumers independent of legacy parser task views', () => {
    expect(matchingFiles(presentationConsumers, /from ['"][^'"]*parser\/types['"]/u)).toEqual([]);
    expect(FINAL_CONSUMERS.every((path) => presentationConsumers.includes(path))).toBe(true);
  });

  it('ports every named legacy behavioral suite off compatibility stores and views', () => {
    const forbidden =
      /(?:store\/TaskStore|store\/TaskDateIndex|tasks\/compat\/legacyTaskView|\bTaskStore\b|configuredTaskStore)/u;

    expect(matchingFiles(LEGACY_TESTS, forbidden)).toEqual([]);
  });

  it('keeps every test consumer independent of compatibility stores and views', () => {
    const testConsumers = typeScriptFiles('test').filter(
      (path) => path !== 'test/tasks/task-consumer-contract.test.ts',
    );
    const forbidden =
      /(?:src\/store\/TaskStore|src\/store\/TaskDateIndex|src\/tasks\/compat\/legacyTaskView|configuredTaskStore)/u;

    expect(matchingFiles(testConsumers, forbidden)).toEqual([]);
  });

  it('keeps task-scoped vault writes out of production consumers', () => {
    expect(matchingFiles(taskMutationConsumers, /\.vault\.process\s*\(/u)).toEqual([]);
  });

  it('keeps premature statistics and time-tracking presentation absent', () => {
    const production = productionFiles.map(source).join('\n');
    expect(production).not.toMatch(/estimateMin|spentMin|formatMinutes/u);
  });
});
