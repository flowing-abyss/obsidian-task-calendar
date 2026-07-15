import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

const REMOVED_COMPATIBILITY_FILES = [
  'src/store/TaskStore.ts',
  'src/store/TaskDateIndex.ts',
  'src/tasks/compat/legacyTaskView.ts',
] as const;

const PARSER_GRAMMAR_TESTS = new Set([
  'test/blockquote-tasks.test.ts',
  'test/duration-field.test.ts',
  'test/parser.test.ts',
  'test/status-symbol-validation.test.ts',
  'test/subitem-parser-deep.test.ts',
  'test/subitem-parser.test.ts',
  'test/task-parser-deep.test.ts',
]);

const FORBIDDEN_TEST_COMPATIBILITY =
  /(?:store\/TaskStore(?:\.ts)?(?=['"])|store\/TaskDateIndex(?:\.ts)?(?=['"])|tasks\/compat\/legacyTaskView(?:\.ts)?(?=['"])|\bTaskStore\b|\b(?:LegacyTaskCommentView|LegacySubtaskView|LegacyTaskView|legacyTaskView|legacyTaskViews|taskRefOf|rebuildLegacyTaskStack)\b|\b(?:class|interface|type|const|let|var|function)\s+TaskDateIndex\b|configuredTaskStore)/u;

const FORBIDDEN_PRODUCTION_COMPATIBILITY =
  /(?:store\/TaskStore(?:\.[cm]?[jt]s)?(?=['"])|store\/TaskDateIndex(?:\.[cm]?[jt]s)?(?=['"])|tasks\/compat\/legacyTaskView(?:\.[cm]?[jt]s)?(?=['"])|plugin\.store|\b(?:TaskStore|LegacyTaskCommentView|LegacySubtaskView|LegacyTaskView|legacyTaskView|legacyTaskViews|taskRefOf|rebuildLegacyTaskStack|configuredTaskStore)\b)/u;

const TASK_DATE_INDEX_DECLARATION =
  /\b(?:export\s+)?(?:class|interface|type|const|let|var|function)\s+TaskDateIndex\b/gu;
const CANONICAL_TASK_DATE_INDEX = 'src/tasks/infrastructure/TaskDateIndex.ts';
const CANONICAL_TASK_DATE_INDEX_DECLARATION = 'export class TaskDateIndex';

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function matchingFiles(paths: readonly string[], pattern: RegExp): string[] {
  return paths.filter((path) => pattern.test(source(path)));
}

function hasForbiddenProductionCompatibility(path: string, candidate: string): boolean {
  if (FORBIDDEN_PRODUCTION_COMPATIBILITY.test(candidate)) return true;

  const taskDateIndexDeclarations = candidate.match(TASK_DATE_INDEX_DECLARATION) ?? [];
  if (taskDateIndexDeclarations.length === 0) return false;

  return (
    path !== CANONICAL_TASK_DATE_INDEX ||
    taskDateIndexDeclarations.length !== 1 ||
    taskDateIndexDeclarations[0] !== CANONICAL_TASK_DATE_INDEX_DECLARATION
  );
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
  const productionConsumers = productionFiles;
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

  it('permanently removes compatibility read stores, views, and their Knip ignores', () => {
    const existingCompatibilityFiles = REMOVED_COMPATIBILITY_FILES.filter((path) =>
      existsSync(resolve(ROOT, path)),
    );
    const knipIgnores = (JSON.parse(source('knip.json')).ignore ?? []) as string[];

    expect({ existingCompatibilityFiles, knipIgnores }).toEqual({
      existingCompatibilityFiles: [],
      knipIgnores: [],
    });
  });

  it('routes every production source through final task contracts', () => {
    expect(
      productionConsumers.filter((path) => hasForbiddenProductionCompatibility(path, source(path))),
    ).toEqual([]);
  });

  it('rejects local compatibility declarations from production sources', () => {
    const compatibilityDeclarations = [
      'class TaskDateIndex {}',
      'interface LegacyTaskView {}',
      'const legacyTaskView = {};',
    ];

    expect(
      compatibilityDeclarations.filter((candidate) =>
        hasForbiddenProductionCompatibility('src/example.ts', candidate),
      ),
    ).toEqual(compatibilityDeclarations);
  });

  it('recognizes aliased and suffix compatibility imports in production sources', () => {
    const compatibilityImports = [
      "import { createStore as oldStore } from '@/store/TaskStore';",
      "import { TaskDateIndex as OldIndex } from '@/store/TaskDateIndex.ts';",
      "import { taskRefOf as oldRef } from '@/tasks/compat/legacyTaskView.js';",
    ];

    expect(
      compatibilityImports.filter((candidate) =>
        hasForbiddenProductionCompatibility('src/example.ts', candidate),
      ),
    ).toEqual(compatibilityImports);
  });

  it('allows only the expected canonical TaskDateIndex declaration', () => {
    expect(
      hasForbiddenProductionCompatibility(
        CANONICAL_TASK_DATE_INDEX,
        'export class TaskDateIndex<T> {}',
      ),
    ).toBe(false);
    expect(
      hasForbiddenProductionCompatibility(
        CANONICAL_TASK_DATE_INDEX,
        'export class TaskDateIndex<T> {}\nconst legacyTaskView = {};',
      ),
    ).toBe(true);
    expect(
      hasForbiddenProductionCompatibility(
        CANONICAL_TASK_DATE_INDEX,
        'export class TaskDateIndex<T> {}\ninterface TaskDateIndex {}',
      ),
    ).toBe(true);
  });

  it('keeps the final read model independent of legacy parser projections and task shapes', () => {
    const finalReadModel = productionFiles.filter((path) =>
      /^src\/tasks\/(?:application|domain|infrastructure)\//u.test(path),
    );
    const forbidden =
      /(?:parser\/legacyTaskProjection|parser\/SubItemParser|from ['"][^'"]*parser\/types['"])/u;

    expect(matchingFiles(finalReadModel, forbidden)).toEqual([]);
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

  it('recognizes aliased compatibility imports and local compatibility stubs', () => {
    const straightforwardReintroductions = [
      "import { createStore as oldStore } from '@/store/TaskStore';",
      "import { taskRefOf as oldRef } from '@/tasks/compat/legacyTaskView';",
      'const TaskStore = vi.fn();',
      'class TaskDateIndex {}',
      'interface LegacyTaskView {}',
    ];

    expect(
      straightforwardReintroductions.filter((candidate) =>
        FORBIDDEN_TEST_COMPATIBILITY.test(candidate),
      ),
    ).toEqual(straightforwardReintroductions);
  });

  it('keeps every test consumer independent of compatibility stores and views', () => {
    const testConsumers = typeScriptFiles('test').filter(
      (path) => path !== 'test/tasks/task-consumer-contract.test.ts',
    );
    expect(matchingFiles(testConsumers, FORBIDDEN_TEST_COMPATIBILITY)).toEqual([]);
  });

  it('keeps non-parser tests and shared fixtures on final snapshot shapes only', () => {
    const testConsumers = typeScriptFiles('test').filter(
      (path) =>
        path !== 'test/tasks/task-consumer-contract.test.ts' && !PARSER_GRAMMAR_TESTS.has(path),
    );
    const forbidden =
      /(?:from ['"][^'"]*parser\/types['"]|\bTask\s*&\s*TaskSnapshot\b|\bSubTask\s*&\s*SubtaskSnapshot\b|\bTaskComment\s*&\s*TaskCommentSnapshot\b)/u;

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
