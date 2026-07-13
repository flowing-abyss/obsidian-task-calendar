import type { FieldUpdate, TaskCommand, TaskPatch } from '../../domain/commands';
import {
  TaskMarkdownCodec,
  type LineEdit,
  type LineEditResult,
  type ParsedTaskLine,
} from './TaskMarkdownCodec';

function fieldEdit(field: 'due' | 'scheduled' | 'start', update: FieldUpdate<string>): LineEdit {
  return {
    type: 'set-date',
    field,
    value: update.type === 'set' ? update.value : null,
  };
}

function orderedPatchEdits(parsed: ParsedTaskLine, patch: TaskPatch): readonly LineEdit[] {
  const edits: LineEdit[] = [];
  if (patch.scheduled) edits.push(fieldEdit('scheduled', patch.scheduled));

  if (patch.start?.type === 'clear') edits.push(fieldEdit('start', patch.start));
  if (patch.due?.type === 'clear') edits.push(fieldEdit('due', patch.due));

  const start = patch.start?.type === 'set' ? patch.start : undefined;
  const due = patch.due?.type === 'set' ? patch.due : undefined;
  if (start && due && parsed.planning.due !== undefined && start.value > parsed.planning.due) {
    edits.push(fieldEdit('due', due), fieldEdit('start', start));
  } else {
    if (start) edits.push(fieldEdit('start', start));
    if (due) edits.push(fieldEdit('due', due));
  }
  return edits;
}

/** Applies one planning command to a task line without exposing transient intermediate states. */
export function applyPlanningCommand(
  codec: TaskMarkdownCodec,
  sourceLine: string,
  command: TaskCommand,
): LineEditResult {
  const parsed = codec.parseLine(sourceLine, { filePath: '', line: 0 });
  if (!parsed) return { type: 'invalid', issues: [{ code: 'invalid-task-syntax' }] };

  let edits: readonly LineEdit[];
  if (command.type === 'reschedule') {
    edits = [
      {
        type: 'set-date',
        field: parsed.planning.scheduled ? 'scheduled' : 'due',
        value: command.date,
      },
    ];
  } else {
    const start = command.patch.start?.type === 'set' ? command.patch.start.value : undefined;
    const due = command.patch.due?.type === 'set' ? command.patch.due.value : undefined;
    if (start !== undefined && due !== undefined && start > due) {
      return { type: 'invalid', issues: [{ code: 'inverted-span', field: 'start,due' }] };
    }
    edits = orderedPatchEdits(parsed, command.patch);
  }

  let current = sourceLine;
  let changed = false;
  for (const edit of edits) {
    const result = codec.applyLineEdit(current, edit);
    if (result.type === 'invalid') return result;
    if (result.type === 'changed') {
      current = result.content;
      changed = true;
    }
  }
  return changed
    ? { type: 'changed', content: current }
    : { type: 'unchanged', content: sourceLine };
}
