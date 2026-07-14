import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type OperationFamily =
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
  scope: 'project-note metadata' | 'vault-wide tag rename' | 'destination-note provisioning';
  reason: string;
}

interface CanonicalTaskWriterReason {
  scope: 'single-task transaction';
  reason: string;
}

const SRC_ROOT = resolve(import.meta.dirname, '..', 'src');

// Temporary migration debt only. Task 5A may replace applicable entries with the single named
// ObsidianTaskRepository boundary; every later vertical operation-family task must shrink this
// list in the same commit. Do not add sites or blanket-ignore source paths.
const LEGACY_TASK_WRITERS: Record<string, LegacyWriterReason> = {
  'src/projects/ProjectManager.ts#ProjectManager.constructor#new TaskMutationService#1': {
    families: ['creation/deletion/movement'],
    reason: 'Project assignment still moves task blocks through the legacy service.',
  },
  'src/mutation/TaskMutationService.ts#TaskMutationService.applyToLines#vault.process#1': {
    families: ['creation/deletion/movement'],
    reason: 'Legacy mutation module remains until ProjectManager move migration in Task 10B.',
  },
  'src/mutation/TaskMutationService.ts#TaskMutationService.moveTaskToFile#vault.process#1': {
    families: ['creation/deletion/movement'],
    reason: 'Legacy move appends the captured task block to the destination first.',
  },
  'src/mutation/TaskMutationService.ts#TaskMutationService.moveTaskToFile#vault.process#2': {
    families: ['creation/deletion/movement'],
    reason: 'Legacy move removes the relocated task block from the source second.',
  },
};

const CANONICAL_TASK_WRITERS: Record<string, CanonicalTaskWriterReason> = {
  'src/tasks/infrastructure/obsidian/ObsidianTaskRepository.ts#ObsidianTaskRepository.processFile#vault.process#1':
    {
      scope: 'single-task transaction',
      reason:
        'The sole canonical revision-confirming transaction boundary for migrated task commands.',
    },
};

// Project frontmatter/status writes are deliberately outside the task-write migration. Keeping
// them explicit still makes any new direct vault writer fail this fitness test.
const PERMITTED_NON_TASK_WRITERS: Record<string, NonTaskWriterReason> = {
  'src/resolvers/DailyNoteResolver.ts#DailyNoteResolver.createNoteWithTemplate#vault.create#1': {
    scope: 'destination-note provisioning',
    reason: 'Creates the empty Templater destination note before template expansion.',
  },
  'src/resolvers/DailyNoteResolver.ts#DailyNoteResolver.createNoteWithTemplate#vault.create#2': {
    scope: 'destination-note provisioning',
    reason: 'Creates a daily or project note from a raw template.',
  },
  'src/resolvers/DailyNoteResolver.ts#DailyNoteResolver.createNoteWithTemplate#vault.create#3': {
    scope: 'destination-note provisioning',
    reason: 'Creates an empty daily or project destination note.',
  },
  'src/tasks/infrastructure/obsidian/ObsidianTaskDestinationProvider.ts#ObsidianTaskDestinationProvider.prepare#vault.create#1':
    {
      scope: 'destination-note provisioning',
      reason:
        'Creates an explicitly provisionable or configured custom note without inserting task Markdown.',
    },
  'src/tags/TagManager.ts#TagManager.renameTag#vault.process#1': {
    scope: 'vault-wide tag rename',
    reason: 'Global tag rename intentionally updates tag text in every note, including non-tasks.',
  },
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
  it('keeps TaskStore command-only with no read bridge or index subscription', () => {
    const path = resolve(SRC_ROOT, 'store', 'TaskStore.ts');
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const taskStore = source.statements.find(
      (statement): statement is ts.ClassDeclaration =>
        ts.isClassDeclaration(statement) && statement.name?.text === 'TaskStore',
    );
    expect(taskStore).toBeDefined();
    const members = new Set(
      taskStore?.members.flatMap((member) => {
        if (!('name' in member) || !member.name) return [];
        return [member.name.getText(source)];
      }),
    );
    expect(members).not.toContain('getTasks');
    expect(members).not.toContain('getTasksForDate');
    expect(members).not.toContain('getTasksForDateRange');
    expect(members).not.toContain('taskQueries');
    expect(members).not.toContain('queries');
    expect(members).not.toContain('onUpdate');
    expect(members).not.toContain('listeners');
    expect(members).not.toContain('pendingFiles');

    let subscribes = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'subscribe'
      ) {
        subscribes = true;
      }
      ts.forEachChild(node, visit);
    };
    if (taskStore) visit(taskStore);
    expect(subscribes).toBe(false);
  });

  it('matches the named, reasoned writer allowlist exactly', () => {
    const allowlisted = [
      ...Object.keys(LEGACY_TASK_WRITERS),
      ...Object.keys(CANONICAL_TASK_WRITERS),
      ...Object.keys(PERMITTED_NON_TASK_WRITERS),
    ].sort();

    expect(writerSites()).toEqual(allowlisted);
  });

  it('keeps only the ProjectManager move bridge until Task 10B', () => {
    const constructionSites = Object.keys(LEGACY_TASK_WRITERS).filter((site) =>
      site.includes('#new TaskMutationService#'),
    );

    expect(constructionSites).toHaveLength(1);
  });

  it('has no remaining legacy description, comment, or subtask writer family', () => {
    expect(
      Object.values(LEGACY_TASK_WRITERS).some((entry) =>
        entry.families.includes('description/comments/subtasks'),
      ),
    ).toBe(false);
  });

  it('keeps exactly one canonical single-task transaction boundary', () => {
    expect(Object.keys(CANONICAL_TASK_WRITERS)).toEqual([
      'src/tasks/infrastructure/obsidian/ObsidianTaskRepository.ts#ObsidianTaskRepository.processFile#vault.process#1',
    ]);
  });

  it('documents the operation family and reason for every temporary task writer', () => {
    for (const entry of Object.values(LEGACY_TASK_WRITERS)) {
      expect(entry.families.length).toBeGreaterThan(0);
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
    for (const entry of Object.values(PERMITTED_NON_TASK_WRITERS)) {
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
    for (const entry of Object.values(CANONICAL_TASK_WRITERS)) {
      expect(entry.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
