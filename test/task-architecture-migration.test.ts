import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type OperationFamily =
  | 'planning/time/spans'
  | 'status/priority'
  | 'per-task tags'
  | 'title/links'
  | 'description/comments/subtasks'
  | 'creation/deletion/movement';

interface LegacyWriterReason {
  families: OperationFamily[];
  reason: string;
}

interface NonTaskWriterReason {
  scope: 'project-note metadata';
  reason: string;
}

const SRC_ROOT = resolve(import.meta.dirname, '..', 'src');

// Temporary migration debt only. Task 5A may replace applicable entries with the single named
// ObsidianTaskRepository boundary; every later vertical operation-family task must shrink this
// list in the same commit. Do not add sites or blanket-ignore source paths.
const LEGACY_TASK_WRITERS: Record<string, LegacyWriterReason> = {
  'src/store/TaskStore.ts#TaskStore.constructor#new TaskMutationService#1': {
    families: ['status/priority'],
    reason: 'TaskStore owns the legacy calendar/list status and priority command facade.',
  },
  'src/panels/CenterPanel.ts#CenterPanel.constructor#new TaskMutationService#1': {
    families: ['planning/time/spans', 'creation/deletion/movement'],
    reason: 'CenterPanel still performs drag/time mutations and task deletion directly.',
  },
  'src/panels/RightPanel.ts#RightPanel.constructor#new TaskMutationService#1': {
    families: [
      'planning/time/spans',
      'status/priority',
      'per-task tags',
      'title/links',
      'description/comments/subtasks',
      'creation/deletion/movement',
    ],
    reason: 'RightPanel still owns the broad legacy task editor command surface.',
  },
  'src/tags/TagManager.ts#TagManager.constructor#new TaskMutationService#1': {
    families: ['per-task tags'],
    reason: 'TagManager still mutates individual task tags through the legacy service.',
  },
  'src/projects/ProjectManager.ts#ProjectManager.constructor#new TaskMutationService#1': {
    families: ['creation/deletion/movement'],
    reason: 'Project assignment still moves task blocks through the legacy service.',
  },
  'src/mutation/TaskMutationService.ts#TaskMutationService.applyToLines#vault.process#1': {
    families: [
      'planning/time/spans',
      'status/priority',
      'per-task tags',
      'title/links',
      'description/comments/subtasks',
      'creation/deletion/movement',
    ],
    reason: 'Shared legacy task-line transaction boundary pending ObsidianTaskRepository.',
  },
  'src/mutation/TaskMutationService.ts#TaskMutationService.moveTaskToFile#vault.process#1': {
    families: ['creation/deletion/movement'],
    reason: 'Legacy move appends the captured task block to the destination first.',
  },
  'src/mutation/TaskMutationService.ts#TaskMutationService.moveTaskToFile#vault.process#2': {
    families: ['creation/deletion/movement'],
    reason: 'Legacy move removes the relocated task block from the source second.',
  },
  'src/store/TaskStore.ts#TaskStore.addTask#vault.create#1': {
    families: ['creation/deletion/movement'],
    reason: 'Custom-file task creation still creates a destination note in TaskStore.',
  },
  'src/store/TaskStore.ts#TaskStore.addTask#vault.process#1': {
    families: ['creation/deletion/movement'],
    reason: 'Custom-file task creation still appends the new task in TaskStore.',
  },
  'src/resolvers/DailyNoteResolver.ts#DailyNoteResolver.createNoteWithTemplate#vault.create#1': {
    families: ['creation/deletion/movement'],
    reason: 'Templater-backed daily destination creation is part of task creation.',
  },
  'src/resolvers/DailyNoteResolver.ts#DailyNoteResolver.createNoteWithTemplate#vault.create#2': {
    families: ['creation/deletion/movement'],
    reason: 'Raw-template daily destination creation is part of task creation.',
  },
  'src/resolvers/DailyNoteResolver.ts#DailyNoteResolver.createNoteWithTemplate#vault.create#3': {
    families: ['creation/deletion/movement'],
    reason: 'Empty daily destination creation is part of task creation.',
  },
  'src/resolvers/DailyNoteResolver.ts#DailyNoteResolver.insertTask#vault.process#1': {
    families: ['creation/deletion/movement'],
    reason: 'Daily-note task creation still inserts the task block directly.',
  },
  'src/tags/TagManager.ts#TagManager.renameTag#vault.process#1': {
    families: ['per-task tags'],
    reason: 'Vault-wide tag rename still rewrites task tag text directly.',
  },
  'src/panels/CenterPanel.ts#CenterPanel.appendTaskToNote#vault.process#1': {
    families: ['creation/deletion/movement'],
    reason: 'Project-context creation still appends a task from CenterPanel.',
  },
  'src/panels/CenterPanel.ts#CenterPanel.createTask#vault.create#1': {
    families: ['creation/deletion/movement'],
    reason: 'Dateless fallback creation still creates the destination from CenterPanel.',
  },
  'src/panels/CenterPanel.ts#CenterPanel.createTask#vault.process#1': {
    families: ['creation/deletion/movement'],
    reason: 'Dateless fallback creation still appends the task from CenterPanel.',
  },
};

// Project frontmatter/status writes are deliberately outside the task-write migration. Keeping
// them explicit still makes any new direct vault writer fail this fitness test.
const PERMITTED_NON_TASK_WRITERS: Record<string, NonTaskWriterReason> = {
  'src/projects/ProjectManager.ts#ProjectManager.stripInlineStatusTags#vault.process#1': {
    scope: 'project-note metadata',
    reason: 'Project status markers belong to project notes, not task Markdown.',
  },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function memberName(node: ts.Node): string | undefined {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isMethodDeclaration(node) && node.name) return node.name.getText();
  if (ts.isFunctionDeclaration(node)) return node.name?.text;
  return undefined;
}

function ownerName(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    const member = memberName(current);
    if (member) {
      const parent = current.parent;
      const className = ts.isClassDeclaration(parent) ? parent.name?.text : undefined;
      return className ? `${className}.${member}` : member;
    }
    current = current.parent;
  }
  return '<module>';
}

function writerSites(): string[] {
  const sites: string[] = [];
  for (const filePath of sourceFiles(SRC_ROOT)) {
    const source = ts.createSourceFile(
      filePath,
      readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const relativePath = relative(resolve(SRC_ROOT, '..'), filePath).replace(/\\/gu, '/');
    const occurrenceByOwner = new Map<string, number>();

    const record = (node: ts.Node, writer: string): void => {
      const owner = ownerName(node);
      const base = `${relativePath}#${owner}#${writer}`;
      const ordinal = (occurrenceByOwner.get(base) ?? 0) + 1;
      occurrenceByOwner.set(base, ordinal);
      sites.push(`${base}#${ordinal}`);
    };

    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'TaskMutationService'
      ) {
        record(node, 'new TaskMutationService');
      }

      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const operation = node.expression.name.text;
        const receiver = node.expression.expression;
        if (
          (operation === 'process' || operation === 'create') &&
          ((ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'vault') ||
            (ts.isIdentifier(receiver) && receiver.text === 'vault'))
        ) {
          record(node, `vault.${operation}`);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }
  return sites.sort();
}

describe('task architecture migration writer guardrail', () => {
  it('matches the named, reasoned writer allowlist exactly', () => {
    const allowlisted = [
      ...Object.keys(LEGACY_TASK_WRITERS),
      ...Object.keys(PERMITTED_NON_TASK_WRITERS),
    ].sort();

    expect(writerSites()).toEqual(allowlisted);
  });

  it('keeps exactly the five known TaskMutationService construction sites', () => {
    const constructionSites = Object.keys(LEGACY_TASK_WRITERS).filter((site) =>
      site.includes('#new TaskMutationService#'),
    );

    expect(constructionSites).toHaveLength(5);
  });

  it('documents the operation family and reason for every temporary task writer', () => {
    for (const entry of Object.values(LEGACY_TASK_WRITERS)) {
      expect(entry.families.length).toBeGreaterThan(0);
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
    for (const entry of Object.values(PERMITTED_NON_TASK_WRITERS)) {
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
