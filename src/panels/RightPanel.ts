import type { App } from 'obsidian';
import { TFile, setIcon } from 'obsidian';
import type { AppState } from '../app/AppState';
import type { SubTask, Task, TaskComment } from '../parser/types';

type TaskLike = Task | SubTask;

export class RightPanel {
  private el!: HTMLElement;
  private off?: () => void;

  constructor(
    private state: AppState,
    private app: App,
  ) {}

  mount(container: HTMLElement): void {
    this.el = container;
    this.off = this.state.on('taskStack', () => this.render());
    this.render();
  }

  destroy(): void {
    this.off?.();
    this.el?.empty();
  }

  private render(): void {
    this.el.empty();
    const stack = this.state.get('taskStack');
    if (stack.length === 0) {
      this.renderEmpty();
      return;
    }
    const task = stack[stack.length - 1]!;
    this.renderTask(task, stack);
  }

  private renderEmpty(): void {
    const empty = this.el.createDiv({ cls: 'tc-right-empty' });
    const icon = empty.createDiv({ cls: 'tc-right-empty-icon' });
    setIcon(icon, 'mouse-pointer-click');
    empty.createEl('p', { cls: 'tc-right-empty-title', text: 'No task selected' });
    empty.createEl('p', {
      cls: 'tc-right-empty-hint',
      text: 'Click a task to view and edit details',
    });
  }

  private renderTask(task: TaskLike, stack: TaskLike[]): void {
    // Breadcrumb
    if (stack.length > 1) {
      const breadcrumb = this.el.createDiv({ cls: 'tc-breadcrumb' });
      stack.forEach((item, idx) => {
        if (idx > 0) breadcrumb.createEl('span', { cls: 'tc-breadcrumb-sep', text: ' › ' });
        const crumb = breadcrumb.createEl('span', {
          cls: `tc-breadcrumb-item${idx === stack.length - 1 ? ' is-current' : ''}`,
          text: item.text,
        });
        if (idx < stack.length - 1) {
          crumb.addEventListener('click', () => {
            this.state.set('taskStack', stack.slice(0, idx + 1));
          });
        }
      });
    }

    // Header
    const header = this.el.createDiv({ cls: 'tc-right-header' });
    const titleInput = header.createEl('input', {
      cls: 'tc-right-title',
      attr: { type: 'text', value: task.text },
    });
    titleInput.addEventListener('blur', () => {
      if (titleInput.value !== task.text) {
        void this.updateTaskTitle(task, titleInput.value);
      }
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') titleInput.blur();
      if (e.key === 'Escape') {
        titleInput.value = task.text;
        titleInput.blur();
      }
    });

    const headerActions = header.createDiv({ cls: 'tc-right-header-actions' });

    // Open in file button
    const openBtn = headerActions.createEl('button', {
      cls: 'tc-right-action-btn',
      attr: { title: 'Open in file', 'aria-label': 'Open in file' },
      text: '↗',
    });
    openBtn.addEventListener('click', () => {
      void this.openInFile(task);
    });

    // More actions menu button
    const currentTask = task;
    const menuBtn = headerActions.createEl('button', {
      cls: 'tc-right-action-btn',
      text: '⋯',
      attr: { title: 'More actions', 'aria-label': 'More actions' },
    });
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.renderContextMenu(currentTask, menuBtn);
    });

    // Metadata chips
    if ('due' in task || 'priority' in task) {
      const t = task;
      const chips = this.el.createDiv({ cls: 'tc-chips-row' });

      // Date chip
      this.renderDateChip(chips, t);
      // Time chip
      const timeChip = chips.createEl('span', {
        cls: `tc-chip${t.time ? '' : ' tc-chip-empty'}`,
        text: t.time ? `⏰ ${t.time}` : '⏰',
        attr: { title: 'Set time' },
      });
      timeChip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showTimePopover(timeChip, t);
      });
      // Priority chip
      this.renderPriorityChip(chips, t);
      // Tag chips
      const tags = t.rawText.match(/#[\w/-]+/gu) ?? [];
      for (const tag of tags) {
        this.renderTagChip(chips, t, tag);
      }
      // Add tag
      const addTagBtn = chips.createEl('button', { cls: 'tc-chip tc-chip-add', text: '+ tag' });
      addTagBtn.addEventListener('click', () => this.showTagInput(chips, t, addTagBtn));
    }

    // Divider
    this.el.createDiv({ cls: 'tc-right-divider' });

    // Description
    const descSection = this.el.createDiv({ cls: 'tc-right-section' });
    descSection.createEl('div', { cls: 'tc-right-section-label', text: 'Description' });
    const descArea = descSection.createEl('textarea', {
      cls: 'tc-right-desc',
      attr: { placeholder: 'Add a description…', rows: '3' },
    });
    descArea.value = task.description ?? '';
    descArea.addEventListener('blur', () => {
      void this.updateDescription(task, descArea.value);
    });

    // Sub-tasks
    const subSection = this.el.createDiv({ cls: 'tc-right-section' });
    const subHeader = subSection.createDiv({ cls: 'tc-right-section-header' });
    subHeader.createEl('span', { cls: 'tc-right-section-label', text: 'Sub-tasks' });
    const addSubBtn = subHeader.createEl('button', { cls: 'tc-right-add-btn', text: '+ add' });

    const subList = subSection.createDiv({ cls: 'tc-subtask-list' });
    for (const sub of task.subtasks ?? []) {
      this.renderSubTask(subList, sub);
    }

    addSubBtn.addEventListener('click', () => {
      const input = subSection.createEl('input', {
        cls: 'tc-subtask-new-input',
        attr: { type: 'text', placeholder: 'New sub-task…' },
      });
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          void this.addSubTask(task, input.value.trim());
        }
        if (e.key === 'Escape') input.remove();
      });
      input.addEventListener('blur', () => {
        if (input.value.trim()) void this.addSubTask(task, input.value.trim());
        else input.remove();
      });
    });

    // Comments
    const commentSection = this.el.createDiv({ cls: 'tc-right-section' });
    commentSection.createEl('div', { cls: 'tc-right-section-label', text: 'Comments' });

    const commentList = commentSection.createDiv({ cls: 'tc-comment-list' });
    for (const comment of task.comments ?? []) {
      this.renderComment(commentList, comment);
    }

    const commentInput = commentSection.createEl('textarea', {
      cls: 'tc-comment-input',
      attr: { placeholder: 'Write a comment…', rows: '2' },
    });
    const sendBtn = commentSection.createEl('button', {
      cls: 'tc-comment-send',
      text: 'Add comment',
    });
    sendBtn.addEventListener('click', () => {
      if (commentInput.value.trim()) {
        void this.addComment(task, commentInput.value.trim());
        commentInput.value = '';
      }
    });
  }

  private renderSubTask(container: HTMLElement, sub: SubTask): void {
    const row = container.createDiv({ cls: 'tc-subtask-row' });
    const cb = row.createEl('input', {
      cls: 'tc-task-checkbox',
      attr: { type: 'checkbox' },
    });
    cb.checked = sub.status === 'done';
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      void this.toggleSubTask(sub);
    });
    const label = row.createEl('span', {
      cls: `tc-subtask-label${sub.status === 'done' ? ' is-done' : ''}`,
      text: sub.text,
    });
    label.addEventListener('click', () => {
      const stack = this.state.get('taskStack');
      this.state.set('taskStack', [...stack, sub]);
    });

    if ((sub.subtasks?.length ?? 0) > 0) {
      const done = sub.subtasks!.filter((s) => s.status === 'done').length;
      row.createEl('span', { cls: 'tc-subtask-progress', text: `${done}/${sub.subtasks!.length}` });
    }
  }

  private renderComment(container: HTMLElement, comment: TaskComment): void {
    const row = container.createDiv({ cls: 'tc-comment-row' });
    if (comment.date) {
      row.createEl('span', { cls: 'tc-comment-date', text: comment.date });
    }
    row.createEl('p', { cls: 'tc-comment-text', text: comment.text });
  }

  private renderDateChip(container: HTMLElement, task: Task): void {
    const d = task.due ?? task.scheduled;
    const chip = container.createEl('button', {
      cls: `tc-chip${d ? '' : ' tc-chip-empty'}`,
      text: d ? `📅 ${this.formatDate(d)}` : '📅 Date',
    });
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showDatePopover(chip, task);
    });
  }

  private renderPriorityChip(container: HTMLElement, task: Task): void {
    const labels: Record<string, string> = {
      A: '⏫ High',
      B: '🔼 Medium',
      C: 'Priority',
      D: '🔽 Low',
    };
    const chip = container.createEl('button', {
      cls: `tc-chip${task.priority === 'C' ? ' tc-chip-empty' : ''}`,
      text: labels[task.priority] ?? 'Priority',
    });
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showPriorityPopover(chip, task);
    });
  }

  private renderTagChip(container: HTMLElement, task: Task, tag: string): void {
    const chip = container.createEl('span', { cls: 'tc-chip tc-chip-tag' });
    chip.createEl('span', { text: tag });
    const x = chip.createEl('button', { cls: 'tc-chip-remove', text: '×' });
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.removeTag(task, tag);
    });
  }

  private clearPopovers(): void {
    this.el.querySelectorAll('.tc-popover').forEach((el) => el.remove());
  }

  private showDatePopover(anchor: HTMLElement, task: Task): void {
    const already = this.el.querySelector('.tc-date-popover');
    this.clearPopovers();
    if (already) return;

    const pop = this.el.createDiv({ cls: 'tc-popover tc-date-popover' });
    const input = pop.createEl('input', {
      cls: 'tc-date-input',
      attr: { type: 'date', value: task.due ?? task.scheduled ?? '' },
    });
    input.addEventListener('change', () => {
      void this.updateDate(task, input.value);
      pop.remove();
    });
    input.addEventListener('blur', () => window.setTimeout(() => pop.remove(), 200));
    window.setTimeout(() => input.focus(), 0);
  }

  private showPriorityPopover(anchor: HTMLElement, task: Task): void {
    const already = this.el.querySelector('.tc-priority-popover');
    this.clearPopovers();
    if (already) return;

    const pop = this.el.createDiv({ cls: 'tc-popover tc-priority-popover' });
    const options: Array<{ value: string; label: string }> = [
      { value: 'A', label: '⏫ High' },
      { value: 'B', label: '🔼 Medium' },
      { value: 'C', label: 'None' },
      { value: 'D', label: '🔽 Low' },
    ];
    for (const opt of options) {
      const btn = pop.createEl('button', {
        cls: `tc-priority-option${task.priority === opt.value ? ' is-active' : ''}`,
        text: opt.label,
      });
      btn.addEventListener('click', () => {
        void this.updatePriority(task, opt.value);
        pop.remove();
      });
    }
    // Dismiss popover on next click outside — use container element to avoid
    // direct `document` usage (Obsidian lint rule)
    window.setTimeout(() => {
      this.el.addEventListener('click', () => pop.remove(), { once: true });
    }, 0);
  }

  private showTagInput(container: HTMLElement, task: Task, _anchor: HTMLElement): void {
    const datalistId = 'tc-tag-suggestions';
    const existing = this.el.querySelector(`#${datalistId}`);
    if (existing) existing.remove();

    const tags = Object.keys(
      (this.app.metadataCache as unknown as { getTags(): Record<string, number> }).getTags(),
    );
    const datalist = container.createEl('datalist', { attr: { id: datalistId } });
    for (const tag of tags) {
      datalist.createEl('option', { attr: { value: tag } });
    }

    const input = container.createEl('input', {
      cls: 'tc-tag-input',
      attr: { type: 'text', placeholder: '#Tag', list: datalistId },
    });
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        void this.addTag(task, input.value.trim());
        input.remove();
        datalist.remove();
      }
      if (e.key === 'Escape') {
        input.remove();
        datalist.remove();
      }
    });
    input.addEventListener('blur', () =>
      window.setTimeout(() => {
        input.remove();
        datalist.remove();
      }, 200),
    );
  }

  // ---- Write-back helpers ----

  private async openInFile(task: TaskLike): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    const view = leaf.view as {
      editor?: { setCursor?: (pos: { line: number; ch: number }) => void };
    };
    view.editor?.setCursor?.({ line: task.line, ch: 0 });
  }

  private async updateTaskTitle(task: TaskLike, newText: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      // Replace only the first occurrence of the exact task.text in the line
      // task.text is set from the parsed display text, safe to use as literal
      const escaped = task.text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      lines[task.line] = line.replace(new RegExp(escaped, 'u'), newText);
      return lines.join('\n');
    });
  }

  private async updateDescription(task: TaskLike, newDesc: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const taskLine = lines[task.line];
      if (!taskLine) return data;
      const indent = (/^(\s*)/.exec(taskLine)?.[1] ?? '') + '  ';

      const rangeStart = task.subtaskRange?.from ?? task.line + 1;
      const rangeEnd = task.subtaskRange?.to ?? task.line; // clamp: no children = empty range

      // Remove existing description lines, keeping track of insertion point
      const before = lines.slice(0, rangeStart);
      const inside = lines.slice(rangeStart, rangeEnd + 1).filter((l) => !/^\s*- > /.test(l));
      const after = lines.slice(rangeEnd + 1);

      const descLines = newDesc.trim()
        ? newDesc
            .split('\n')
            .filter(Boolean)
            .map((l) => `${indent}- > ${l}`)
        : [];

      return [...before, ...descLines, ...inside, ...after].join('\n');
    });
  }

  private async addSubTask(task: TaskLike, text: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const taskLine = lines[task.line];
      if (!taskLine) return data;
      const indent = (/^(\s*)/.exec(taskLine)?.[1] ?? '') + '  ';
      const newLine = `${indent}- [ ] ${text}`;
      const insertAt = task.subtaskRange ? task.subtaskRange.to + 1 : task.line + 1;
      lines.splice(insertAt, 0, newLine);
      return lines.join('\n');
    });
  }

  private async toggleSubTask(sub: SubTask): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(sub.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[sub.line];
      if (!line) return data;
      if (sub.status === 'open') {
        lines[sub.line] = line.replace(/- \[ \]/, '- [x]');
      } else {
        lines[sub.line] = line.replace(/- \[x\]/i, '- [ ]');
      }
      return lines.join('\n');
    });
  }

  private async addComment(task: TaskLike, text: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const today = window.moment().format('YYYY-MM-DD');
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const taskLine = lines[task.line];
      if (!taskLine) return data;
      const indent = (/^(\s*)/.exec(taskLine)?.[1] ?? '') + '  ';
      const commentLine = `${indent}- ${today}: ${text}`;
      const insertAt = task.subtaskRange ? task.subtaskRange.to + 1 : task.line + 1;
      lines.splice(insertAt, 0, commentLine);
      return lines.join('\n');
    });
  }

  private async updateDate(task: Task, date: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      if (task.due) {
        lines[task.line] = line.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${date}`);
      } else {
        lines[task.line] = line.trimEnd() + ` 📅 ${date}`;
      }
      return lines.join('\n');
    });
  }

  private async updatePriority(task: Task, priority: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const PRIORITY_EMOJIS = ['⏫', '🔼', '🔽'];
    const PRIORITY_MAP: Record<string, string> = { A: '⏫', B: '🔼', D: '🔽' };
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      let updated = line;
      for (const emoji of PRIORITY_EMOJIS) updated = updated.replace(emoji, '');
      updated = updated.trimEnd();
      if (priority !== 'C' && PRIORITY_MAP[priority]) updated += ` ${PRIORITY_MAP[priority]}`;
      lines[task.line] = updated;
      return lines.join('\n');
    });
  }

  private async removeTag(task: Task, tag: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      // Escape the tag for regex use; match the tag not followed by word chars or subtag separator
      const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

      lines[task.line] = line
        .replace(new RegExp(`${escaped}(?![\\w/-])`, 'gu'), '')
        .replace(/\s{2,}/gu, ' ')
        .trimEnd();
      return lines.join('\n');
    });
  }

  private async addTag(task: Task, tag: string): Promise<void> {
    const tagStr = tag.startsWith('#') ? tag : `#${tag}`;
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      lines[task.line] = line.trimEnd() + ` ${tagStr}`;
      return lines.join('\n');
    });
  }

  private showTimePopover(anchor: HTMLElement, task: Task): void {
    const already = this.el.querySelector('.tc-time-popover');
    this.clearPopovers();
    if (already) return;

    const pop = this.el.createEl('div', { cls: 'tc-popover tc-time-popover' });
    const input = pop.createEl('input', {
      attr: { type: 'time', value: task.time ?? '' },
    });
    input.focus();
    input.addEventListener('change', () => {
      void this.updateTime(task, input.value).then(() => pop.remove());
    });
    input.addEventListener('blur', () => window.setTimeout(() => pop.remove(), 200));
    anchor.after(pop);
  }

  private async updateTime(task: Task, time: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;

      const cleaned = line.replace(/⏰\s*\d{1,2}:\d{2}/gu, '').replace(/\s{2,}/gu, ' ');
      lines[task.line] = time ? `${cleaned.trimEnd()} ⏰ ${time}` : cleaned.trim();
      return lines.join('\n');
    });
  }

  private renderContextMenu(task: TaskLike, anchor: HTMLElement): void {
    const existing = this.el.querySelector('.tc-context-menu');
    if (existing) {
      existing.remove();
      return;
    }

    const menu = anchor.createEl('div', { cls: 'tc-context-menu' });

    const deleteItem = menu.createEl('div', { cls: 'tc-context-item', text: 'Delete task' });
    deleteItem.addEventListener('click', () => {
      menu.remove();
      void this.deleteTask(task);
    });

    const copyItem = menu.createEl('div', { cls: 'tc-context-item', text: 'Copy link' });
    copyItem.addEventListener('click', () => {
      menu.remove();
      const name = task.filePath.replace(/\.md$/u, '').split('/').pop() ?? task.filePath;
      void navigator.clipboard.writeText(`[[${name}]]`);
    });

    const dismiss = (e: MouseEvent): void => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        activeDocument.removeEventListener('click', dismiss, true);
      }
    };
    activeDocument.addEventListener('click', dismiss, true);
  }

  private async deleteTask(task: TaskLike): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const from = task.line;
      const to = 'subtaskRange' in task && task.subtaskRange ? task.subtaskRange.to : task.line;
      lines.splice(from, to - from + 1);
      return lines.join('\n');
    });
    this.state.set('taskStack', []);
  }

  private formatDate(d: string): string {
    const today = window.moment().format('YYYY-MM-DD');
    const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');
    if (d === today) return 'Today';
    if (d === tomorrow) return 'Tomorrow';
    return window.moment(d, 'YYYY-MM-DD').format('D MMM');
  }
}
