import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
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

const CANONICAL_TASK_DATE_INDEX = 'src/tasks/infrastructure/TaskDateIndex.ts';
const TASK_DATE_INDEX_CONSUMER = 'src/tasks/infrastructure/TaskIndex.ts';
const FORBIDDEN_PRODUCTION_IDENTIFIERS = new Set([
  'TaskStore',
  'LegacyTaskCommentView',
  'LegacySubtaskView',
  'LegacyTaskView',
  'legacyTaskView',
  'legacyTaskViews',
  'taskRefOf',
  'rebuildLegacyTaskStack',
  'configuredTaskStore',
]);
const FORBIDDEN_PRODUCTION_MODULE =
  /(?:^|\/)(?:store\/TaskStore|store\/TaskDateIndex|tasks\/compat\/legacyTaskView)(?:\.[cm]?[jt]sx?)?$/u;

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function matchingFiles(paths: readonly string[], pattern: RegExp): string[] {
  return paths.filter((path) => pattern.test(source(path)));
}

function isForbiddenModuleSpecifier(moduleSpecifier: ts.Expression | undefined): boolean {
  return moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)
    ? FORBIDDEN_PRODUCTION_MODULE.test(moduleSpecifier.text)
    : false;
}

function isDeclarationWithName(node: ts.Node): node is ts.NamedDeclaration {
  return (
    ts.isBindingElement(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isExportSpecifier(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isImportClause(node) ||
    ts.isImportEqualsDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isNamespaceExport(node) ||
    ts.isNamespaceImport(node) ||
    ts.isParameter(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isVariableDeclaration(node)
  );
}

function declarationBinds(node: ts.NamedDeclaration, expected: string): boolean {
  const name = ts.getNameOfDeclaration(node);
  if (!name) return false;
  if (ts.isIdentifier(name)) return name.text === expected;
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.some(
      (element) => ts.isBindingElement(element) && declarationBinds(element, expected),
    );
  }
  return false;
}

function isExportedCanonicalTaskDateIndex(path: string, node: ts.NamedDeclaration): boolean {
  if (path !== CANONICAL_TASK_DATE_INDEX || !ts.isClassDeclaration(node)) return false;
  const [typeParameter] = node.typeParameters ?? [];
  return (
    node.name?.text === 'TaskDateIndex' &&
    node.parent.kind === ts.SyntaxKind.SourceFile &&
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true &&
    node.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === false &&
    node.typeParameters?.length === 1 &&
    typeParameter?.name.text === 'T' &&
    typeParameter.constraint === undefined &&
    typeParameter.default === undefined
  );
}

function resolvesCanonicalTaskDateIndex(path: string, moduleSpecifier: string): boolean {
  if (!moduleSpecifier.startsWith('.')) return false;
  const withoutSourceSuffix = (value: string): string => value.replace(/\.[cm]?[jt]sx?$/u, '');
  const imported = withoutSourceSuffix(resolve(dirname(resolve(ROOT, path)), moduleSpecifier));
  const canonical = withoutSourceSuffix(resolve(ROOT, CANONICAL_TASK_DATE_INDEX));
  return imported === canonical;
}

function isCanonicalTaskDateIndexImport(path: string, node: ts.NamedDeclaration): boolean {
  if (!ts.isImportSpecifier(node) || node.name.text !== 'TaskDateIndex') return false;
  if (path !== TASK_DATE_INDEX_CONSUMER) return false;
  if ((node.propertyName ?? node.name).text !== 'TaskDateIndex') return false;
  const importDeclaration = node.parent.parent.parent;
  return (
    ts.isImportDeclaration(importDeclaration) &&
    ts.isStringLiteralLike(importDeclaration.moduleSpecifier) &&
    resolvesCanonicalTaskDateIndex(
      importDeclaration.getSourceFile().fileName,
      importDeclaration.moduleSpecifier.text,
    )
  );
}

function isAllowedTaskDateIndexIdentifier(path: string, node: ts.Identifier): boolean {
  if (
    path === CANONICAL_TASK_DATE_INDEX &&
    ts.isClassDeclaration(node.parent) &&
    node.parent.name === node
  ) {
    return isExportedCanonicalTaskDateIndex(path, node.parent);
  }
  if (path !== TASK_DATE_INDEX_CONSUMER) return false;
  if (ts.isImportSpecifier(node.parent) && node.parent.name === node) {
    return isCanonicalTaskDateIndexImport(path, node.parent);
  }
  return ts.isNewExpression(node.parent) && node.parent.expression === node;
}

function hasForbiddenProductionCompatibility(path: string, candidate: string): boolean {
  const syntax = ts.createSourceFile(
    path,
    candidate,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let forbidden = false;
  let canonicalTaskDateIndexClasses = 0;

  const visit = (node: ts.Node): void => {
    if (forbidden) return;

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      isForbiddenModuleSpecifier(node.moduleSpecifier)
    ) {
      forbidden = true;
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isForbiddenModuleSpecifier(node.moduleReference.expression)
    ) {
      forbidden = true;
      return;
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      isForbiddenModuleSpecifier(node.argument.literal)
    ) {
      forbidden = true;
      return;
    }
    if (
      ts.isModuleDeclaration(node) &&
      ts.isStringLiteral(node.name) &&
      isForbiddenModuleSpecifier(node.name)
    ) {
      forbidden = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      isForbiddenModuleSpecifier(node.arguments[0])
    ) {
      forbidden = true;
      return;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'plugin' &&
      node.name.text === 'store'
    ) {
      forbidden = true;
      return;
    }
    if (ts.isIdentifier(node)) {
      if (FORBIDDEN_PRODUCTION_IDENTIFIERS.has(node.text)) {
        forbidden = true;
        return;
      }
      if (node.text === 'TaskDateIndex' && !isAllowedTaskDateIndexIdentifier(path, node)) {
        forbidden = true;
        return;
      }
    }
    if (isDeclarationWithName(node) && declarationBinds(node, 'TaskDateIndex')) {
      if (isExportedCanonicalTaskDateIndex(path, node)) canonicalTaskDateIndexClasses++;
      else if (!isCanonicalTaskDateIndexImport(path, node)) forbidden = true;
    }

    ts.forEachChild(node, visit);
  };

  visit(syntax);
  return forbidden || (path === CANONICAL_TASK_DATE_INDEX && canonicalTaskDateIndexClasses !== 1);
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
      'new TaskDateIndex();',
      "import { TaskDateIndex } from './tasks/infrastructure/TaskDateIndex';\nnew TaskDateIndex();",
      'enum Compatibility { TaskDateIndex }',
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
      "type OldStore = import('@/store/TaskStore.mts').Store;",
      "declare module '@/tasks/compat/legacyTaskView.cjs' {}",
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
        TASK_DATE_INDEX_CONSUMER,
        "import { TaskDateIndex } from './TaskDateIndex';\nnew TaskDateIndex(() => []);",
      ),
    ).toBe(false);
    expect(
      hasForbiddenProductionCompatibility(
        CANONICAL_TASK_DATE_INDEX,
        'export class TaskDateIndex<T> {}\ninterface TaskDateIndex {}',
      ),
    ).toBe(true);
  });

  it('pins the canonical TaskDateIndex declaration modifiers and generic shape', () => {
    const nearMisses = [
      'export default class TaskDateIndex<T> {}',
      'export class TaskDateIndex {}',
      'export class TaskDateIndex<T, U> {}',
      'export class TaskDateIndex<U> {}',
      'export class TaskDateIndex<T extends object> {}',
      'export class TaskDateIndex<T = unknown> {}',
    ];

    expect(
      nearMisses.filter((candidate) =>
        hasForbiddenProductionCompatibility(CANONICAL_TASK_DATE_INDEX, candidate),
      ),
    ).toEqual(nearMisses);
  });

  it('rejects canonical TaskDateIndex declaration merging and export aliases', () => {
    const disguisedReintroductions = [
      'export class TaskDateIndex<T> {}\nexport namespace TaskDateIndex {}',
      '// export class TaskDateIndex\nconst Replacement = class {};\nexport { Replacement as TaskDateIndex };',
      "const signature = 'export class TaskDateIndex';\nconst Replacement = class {};\nexport { Replacement as TaskDateIndex };",
      'export class TaskDateIndex<T> {}\nexport class TaskDateIndex<U> {}',
      "export class TaskDateIndex<T> {}\nimport { TaskDateIndex } from './TaskDateIndex';",
      'export class TaskDateIndex<T> {}\nexport default TaskDateIndex;',
    ];

    expect(
      disguisedReintroductions.filter((candidate) =>
        hasForbiddenProductionCompatibility(CANONICAL_TASK_DATE_INDEX, candidate),
      ),
    ).toEqual(disguisedReintroductions);
  });

  it('ignores compatibility-looking comments, strings, and ordinary module path values', () => {
    const harmlessText = [
      '// class TaskDateIndex {}',
      "const documentation = 'interface LegacyTaskView {}';",
      "const removedModuleExample = '@/store/TaskStore';",
    ];

    expect(
      harmlessText.filter((candidate) =>
        hasForbiddenProductionCompatibility('src/example.ts', candidate),
      ),
    ).toEqual([]);
    expect(
      hasForbiddenProductionCompatibility(
        CANONICAL_TASK_DATE_INDEX,
        "const documentation = 'export class TaskDateIndex';",
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
