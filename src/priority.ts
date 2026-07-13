import type { TaskPriority } from './tasks/domain/types';

/** Single source of truth for priority level metadata (label, emoji, order). */
export interface PriorityLevel {
  value: TaskPriority;
  label: string;
  /** Markdown emoji glyph written into the task line; '' for D/None (no emoji). */
  emoji: string;
}

export const PRIORITY_LEVELS: PriorityLevel[] = [
  { value: 'A', label: 'Highest', emoji: '🔺' },
  { value: 'B', label: 'High', emoji: '⏫' },
  { value: 'C', label: 'Medium', emoji: '🔼' },
  { value: 'D', label: 'None', emoji: '' },
  { value: 'E', label: 'Low', emoji: '🔽' },
  { value: 'F', label: 'Lowest', emoji: '⏬' },
];
