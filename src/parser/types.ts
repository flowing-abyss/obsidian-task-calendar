export type TaskStatus = 'open' | 'done' | 'cancelled' | 'in-progress';
// A=🔺 Highest, B=⏫ High, C=🔼 Medium, D=normal (no emoji), E=🔽 Low, F=⏬ Lowest
export type TaskPriority = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface Task {
  filePath: string;
  line: number; // 0-based line index
  rawText: string; // full original line, for write-back
  text: string; // display text: metadata emoji and tags stripped
  markdownText: string; // display text with link markup ([[…]], [](…)) preserved
  status: TaskStatus; // 'in-progress' from checkbox '/' only; derived date logic lives in views
  due?: string; // YYYY-MM-DD from 📅
  scheduled?: string; // YYYY-MM-DD from ⏳
  start?: string; // YYYY-MM-DD from 🛫
  completion?: string; // YYYY-MM-DD from ✅
  cancelledDate?: string; // YYYY-MM-DD from ❌
  time?: string; // HH:MM from ⏰
  duration?: number; // minutes, reserved for time-blocking
  recurrence?: string; // text after 🔁, e.g. "every week"
  priority: TaskPriority;
  subtasks?: SubTask[];
  comments?: TaskComment[];
  description?: string;
  subtaskRange?: { from: number; to: number };
  linkCount?: number; // count of links (files/notes) in title+description+comments, precomputed by TaskStore
  dailyNoteDate?: string; // YYYY-MM-DD pre-computed by TaskStore if file is a daily note
  noteColor?: string; // from file frontmatter `color`
  noteTextColor?: string; // from file frontmatter `textColor`
  noteIcon?: string; // from file frontmatter `icon`
}

export interface SubTask {
  filePath: string;
  line: number;
  rawText: string;
  text: string;
  markdownText: string; // display text with link markup ([[…]], [](…)) preserved
  status: 'open' | 'done';
  due?: string;
  scheduled?: string;
  start?: string;
  time?: string;
  priority: TaskPriority;
  recurrence?: string;
  subtasks?: SubTask[];
  comments?: TaskComment[];
  description?: string;
  subtaskRange?: { from: number; to: number };
}

export interface TaskComment {
  line: number;
  date?: string; // YYYY-MM-DD
  text: string;
}

export interface TaskFilter {
  dateRange?: { from: string; to: string }; // YYYY-MM-DD inclusive
  status?: TaskStatus[];
  filePath?: string;
  tag?: string; // filter by vault tag present in task text
  folder?: string; // filter by vault folder prefix of task's file
}

export interface ParseContext {
  filePath: string;
  line: number;
  dailyNoteDate?: string; // pre-computed by store; parser stores it verbatim if provided
  globalTaskFilter?: string; // tag to strip, e.g. '#task'
}
