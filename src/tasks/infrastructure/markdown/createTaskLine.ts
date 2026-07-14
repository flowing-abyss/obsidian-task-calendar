import type { TaskDraft } from '../../application/TaskRepository';
import type { TaskRef } from '../../domain/types';
import { applyTaskCommand } from './applyTaskCommand';
import type { LineEditResult } from './TaskMarkdownCodec';
import { TaskMarkdownCodec } from './TaskMarkdownCodec';

const DRAFT_REF: TaskRef = { filePath: '', line: 0, revision: '' };

/** Builds and validates one root task line without inserting it into any note. */
export function createTaskLine(codec: TaskMarkdownCodec, draft: TaskDraft): LineEditResult {
  if (/[\r\n]/u.test(draft.markdownBody)) {
    return { type: 'invalid', issues: [{ code: 'invalid-title', field: 'title' }] };
  }
  const source = `- [ ] ${draft.markdownBody}`;
  const parsed = codec.parseLine(source, { filePath: '', line: 0 });
  if (!parsed) return { type: 'invalid', issues: [{ code: 'invalid-task-syntax' }] };
  if (parsed.markdownTitle.trim().length === 0) {
    return { type: 'invalid', issues: [{ code: 'invalid-title', field: 'title' }] };
  }
  const sourceIssues = codec.validateLine(source);
  if (sourceIssues.length > 0) return { type: 'invalid', issues: sourceIssues };
  if (draft.initial === undefined || Object.keys(draft.initial).length === 0) {
    return { type: 'unchanged', content: source };
  }
  return applyTaskCommand(codec, source, {
    type: 'patch',
    target: { type: 'task', ref: DRAFT_REF },
    patch: draft.initial,
  });
}
