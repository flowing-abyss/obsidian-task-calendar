import type { App } from 'obsidian';
import { TFile, setIcon } from 'obsidian';
import type { AppState } from '../app/AppState';
import { formatTaskLine } from '../parser/TaskParser';
import type { SubTask, Task, TaskComment } from '../parser/types';
import type { CalendarSettings } from '../settings/types';

type TaskLike = Task | SubTask;

export class RightPanel {
  private el!: HTMLElement;
  private off?: () => void;

  constructor(
    private state: AppState,
    private app: App,
    private settings?: CalendarSettings,
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
      const timeChip = chips.createEl('button', {
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
    const descHeader = descSection.createDiv({ cls: 'tc-right-section-header' });
    descHeader.createEl('span', { cls: 'tc-right-section-label', text: 'Description' });
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
    const totalSubs = task.subtasks?.length ?? 0;
    if (totalSubs > 0) {
      const doneSubs = task.subtasks!.filter((s) => s.status === 'done').length;
      subHeader.createEl('span', {
        cls: 'tc-right-section-count',
        text: `${doneSubs}/${totalSubs}`,
      });
    }

    const subList = subSection.createDiv({ cls: 'tc-subtask-list' });
    for (const sub of task.subtasks ?? []) {
      this.renderSubTask(subList, sub);
    }

    // Inline add-subtask row at the bottom of the subtask list
    const addSubRow = subSection.createDiv({ cls: 'tc-subtask-add-row' });
    addSubRow.createEl('span', { cls: 'tc-subtask-add-icon', text: '+' });
    addSubRow.createEl('span', { cls: 'tc-subtask-add-label', text: 'Add sub-task' });
    addSubRow.addEventListener('click', () => {
      addSubRow.addClass('tc-subtask-add-row--hidden');
      const input = subSection.createEl('input', {
        cls: 'tc-subtask-new-input',
        attr: { type: 'text', placeholder: 'New sub-task…' },
      });
      input.focus();
      let committed = false;
      const commit = (): void => {
        if (committed) return;
        committed = true;
        if (input.value.trim()) void this.addSubTask(task, input.value.trim());
        input.remove();
        addSubRow.removeClass('tc-subtask-add-row--hidden');
      };
      input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          committed = true; // prevent blur from committing
          input.remove();
          addSubRow.removeClass('tc-subtask-add-row--hidden');
        }
      });
      // Delay to allow click on commit button before blur fires
      input.addEventListener('blur', () => window.setTimeout(commit, 150));
    });

    // Comments
    const commentSection = this.el.createDiv({ cls: 'tc-right-section' });
    const commentHeader = commentSection.createDiv({ cls: 'tc-right-section-header' });
    commentHeader.createEl('span', { cls: 'tc-right-section-label', text: 'Comments' });
    const commentCount = task.comments?.length ?? 0;
    if (commentCount > 0) {
      commentHeader.createEl('span', {
        cls: 'tc-right-section-count',
        text: String(commentCount),
      });
    }

    const commentList = commentSection.createDiv({ cls: 'tc-comment-list' });
    for (const comment of task.comments ?? []) {
      this.renderComment(commentList, comment, task);
    }

    // Always-visible textarea — Enter submits, Shift+Enter inserts newline
    const commentInput = commentSection.createEl('textarea', {
      cls: 'tc-comment-input',
      attr: { placeholder: 'Write a comment…', rows: '2' },
    });
    commentInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = commentInput.value.trim();
        if (text) {
          void this.addComment(task, text, commentList, commentInput);
        }
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

    // Content wrapper holds the label and optional meta indicators
    const content = row.createDiv({ cls: 'tc-subtask-content' });
    const label = content.createEl('span', {
      cls: `tc-subtask-label${sub.status === 'done' ? ' is-done' : ''}`,
      text: sub.text,
    });
    label.addEventListener('click', () => {
      const stack = this.state.get('taskStack');
      this.state.set('taskStack', [...stack, sub]);
    });

    // Show nested subtask progress and comment count if present
    const subCount = sub.subtasks?.length ?? 0;
    const commentCount = sub.comments?.length ?? 0;
    if (subCount > 0 || commentCount > 0) {
      const subMeta = content.createDiv({ cls: 'tc-subtask-meta' });
      if (subCount > 0) {
        const done = sub.subtasks!.filter((s) => s.status === 'done').length;
        subMeta.createEl('span', {
          cls: 'tc-subtask-progress',
          text: `${done}/${subCount}`,
        });
      }
      if (commentCount > 0) {
        subMeta.createEl('span', {
          cls: 'tc-subtask-comment-count',
          text: `💬 ${commentCount}`,
        });
      }
    }
  }

  private renderComment(container: HTMLElement, comment: TaskComment, task: TaskLike): void {
    const row = container.createDiv({ cls: 'tc-comment-row' });
    if (comment.date) {
      const m = window.moment(comment.date, 'YYYY-MM-DD');
      const diff = m.diff(window.moment(), 'days');
      const label = Math.abs(diff) < 7 ? m.fromNow() : m.format('D MMM YYYY');
      row.createEl('span', { cls: 'tc-comment-date', text: label });
    }
    const textEl = row.createEl('p', { cls: 'tc-comment-text', text: comment.text });
    textEl.addEventListener('click', () => {
      textEl.remove();
      const textarea = row.createEl('textarea', { cls: 'tc-comment-edit-input' });
      textarea.value = comment.text;
      textarea.focus();
      textarea.select();
      let saved = false;
      const finish = (): void => {
        if (saved) return;
        saved = true;
        const val = textarea.value.trim();
        textarea.remove();
        if (val === '') {
          this.deleteComment(task, comment).catch(() => {
            row.createEl('p', { cls: 'tc-comment-text', text: comment.text });
          });
        } else if (val !== comment.text) {
          this.updateComment(task, comment, val).catch(() => {
            row.createEl('p', { cls: 'tc-comment-text', text: comment.text });
          });
        } else {
          row.createEl('p', { cls: 'tc-comment-text', text: comment.text });
        }
      };
      textarea.addEventListener('blur', () => window.setTimeout(finish, 150));
      textarea.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          textarea.blur();
        }
        if (e.key === 'Escape') {
          saved = true;
          textarea.remove();
          row.createEl('p', { cls: 'tc-comment-text', text: comment.text });
        }
      });
    });
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
      A: '🚩 Highest',
      B: '🚩 High',
      C: '🚩 Medium',
      D: 'Priority',
      E: '🚩 Low',
      F: '🚩 Lowest',
    };
    const chip = container.createEl('button', {
      cls: `tc-chip tc-priority-chip tc-priority-chip--${task.priority ?? 'D'}${task.priority === 'D' ? ' tc-chip-empty' : ''}`,
      text: labels[task.priority] ?? 'Priority',
      attr: { 'data-priority': task.priority ?? 'D' },
    });
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showPriorityPopover(chip, task);
    });
  }

  private renderTagChip(container: HTMLElement, task: Task, tag: string): void {
    const chip = container.createEl('span', { cls: 'tc-chip tc-chip-tag' });
    const color = this.getTagColor(tag);
    if (color) chip.setCssProps({ '--tc-chip-tag-color': color });
    chip.createEl('span', { text: tag });
    const x = chip.createEl('button', { cls: 'tc-chip-remove', text: '×' });
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.removeTag(task, tag);
    });
  }

  private getTagColor(tag: string): string | undefined {
    if (!this.settings) return undefined;
    const noHash = tag.replace(/^#/, '');
    for (const group of this.settings.tagGroups) {
      if (group.mode === 'prefix' && group.prefix) {
        if (noHash === group.prefix || noHash.startsWith(`${group.prefix}/`)) {
          return group.color;
        }
      } else if (group.mode === 'manual' && group.tags) {
        if (group.tags.includes(tag) || group.tags.includes(noHash)) {
          return group.color;
        }
      }
    }
    return undefined;
  }

  private clearPopovers(): void {
    this.el.querySelectorAll('.tc-popover').forEach((el) => el.remove());
  }

  private showDatePopover(anchor: HTMLElement, task: Task): void {
    const already = this.el.querySelector('.tc-date-popover');
    this.clearPopovers();
    if (already) return;

    const pop = this.el.createDiv({ cls: 'tc-popover tc-date-popover tc-popover-anchored' });
    // Use setCssProps for dynamic offset values (position/z-index are in the CSS class)
    pop.setCssProps({
      '--tc-pop-top': `${anchor.offsetTop + anchor.offsetHeight + 4}px`,
      '--tc-pop-left': `${anchor.offsetLeft}px`,
    });

    const inputRow = pop.createDiv({ cls: 'tc-popover-input-row' });
    const input = inputRow.createEl('input', {
      cls: 'tc-date-input',
      attr: { type: 'date', value: task.due ?? task.scheduled ?? '' },
    });
    input.addEventListener('change', () => {
      void this.updateDate(task, input.value);
      pop.remove();
    });
    input.addEventListener('blur', () => window.setTimeout(() => pop.remove(), 200));
    window.setTimeout(() => input.focus(), 0);

    const clearBtn = inputRow.createEl('button', {
      cls: 'tc-popover-clear-icon-btn',
      attr: { title: 'Clear date', 'aria-label': 'Clear date' },
    });
    setIcon(clearBtn, 'x');
    clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
    clearBtn.addEventListener('click', () => {
      void this.clearDate(task);
      pop.remove();
    });
  }

  private showPriorityPopover(anchor: HTMLElement, task: Task): void {
    const already = this.el.querySelector('.tc-priority-popover');
    this.clearPopovers();
    if (already) return;

    const pop = this.el.createDiv({ cls: 'tc-popover tc-priority-popover tc-popover-anchored' });
    pop.setCssProps({
      '--tc-pop-top': `${anchor.offsetTop + anchor.offsetHeight + 4}px`,
      '--tc-pop-left': `${anchor.offsetLeft}px`,
    });

    const currentPriority = anchor.getAttribute('data-priority') ?? task.priority ?? 'D';
    const options: Array<{ value: string; label: string }> = [
      { value: 'A', label: 'Highest' },
      { value: 'B', label: 'High' },
      { value: 'C', label: 'Medium' },
      { value: 'D', label: 'None' },
      { value: 'E', label: 'Low' },
      { value: 'F', label: 'Lowest' },
    ];
    for (const opt of options) {
      const btn = pop.createEl('button', {
        cls: `tc-priority-option${currentPriority === opt.value ? ' is-active' : ''}`,
        text: opt.label,
        attr: { 'data-priority': opt.value },
      });
      btn.addEventListener('click', () => {
        // Optimistic update on the chip
        const chipLabels: Record<string, string> = {
          A: '🚩 Highest',
          B: '🚩 High',
          C: '🚩 Medium',
          D: 'Priority',
          E: '🚩 Low',
          F: '🚩 Lowest',
        };
        anchor.textContent = chipLabels[opt.value] ?? 'Priority';
        anchor.setAttribute('data-priority', opt.value);
        anchor.className = `tc-chip tc-priority-chip tc-priority-chip--${opt.value}${opt.value === 'D' ? ' tc-chip-empty' : ''}`;
        pop.remove();
        void this.updatePriority(task, opt.value);
      });
    }
    window.setTimeout(() => {
      this.el.addEventListener('click', () => pop.remove(), { once: true });
    }, 0);
  }

  private showTagInput(container: HTMLElement, task: Task, _anchor: HTMLElement): void {
    const datalistId = 'tc-tag-suggestions';
    const existing = this.el.querySelector(`#${datalistId}`);
    if (existing) existing.remove();

    const rawTags = Object.keys(
      (this.app.metadataCache as unknown as { getTags(): Record<string, number> }).getTags(),
    );
    // Sort: group by root tag, parent before children within each group
    const sortedTags = [...rawTags];
    sortedTags.sort((a, b) => {
      const aClean = a.startsWith('#') ? a.slice(1) : a;
      const bClean = b.startsWith('#') ? b.slice(1) : b;
      const aRoot = aClean.split('/')[0] ?? '';
      const bRoot = bClean.split('/')[0] ?? '';
      if (aRoot !== bRoot) return aRoot.localeCompare(bRoot);
      const da = (aClean.match(/\//g) ?? []).length;
      const db = (bClean.match(/\//g) ?? []).length;
      if (da !== db) return da - db;
      return aClean.localeCompare(bClean);
    });
    const datalist = container.createEl('datalist', { attr: { id: datalistId } });
    for (const tag of sortedTags) {
      // Obsidian returns tags with '#' prefix already; ensure it
      const val = tag.startsWith('#') ? tag : `#${tag}`;
      datalist.createEl('option', { attr: { value: val } });
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
      const prefixMatch = /^(\s*- \[[ xX/]\] )/.exec(line);
      if (!prefixMatch) return data;
      const prefix = prefixMatch[1] ?? '';
      // Derive suffix from the raw file line (available here as `line`) rather than task.text.
      // task.text has wikilinks collapsed and emoji stripped, so its .length differs from
      // the raw title length. Find where metadata begins in the raw file line instead.
      const rawAfterPrefix = line.slice(prefix.length);
      // Find where metadata begins: a space followed by a known metadata emoji or hashtag.
      // Use a single \s (no quantifier) to avoid super-linear backtracking reported by sonarjs.
      const spaceIdx = rawAfterPrefix.search(/\s[📅⏳🛫✅❌⏰🔁🔺⏫🔼🔽⏬#➕]/u);
      const suffix = spaceIdx >= 0 ? rawAfterPrefix.slice(spaceIdx) : '';
      lines[task.line] = formatTaskLine(prefix + newText + suffix);
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

  private async addComment(
    task: TaskLike,
    text: string,
    commentList: HTMLElement,
    inputEl: HTMLTextAreaElement,
  ): Promise<void> {
    // Optimistic DOM update: show the new comment immediately before writing to disk
    const row = commentList.createDiv({ cls: 'tc-comment-row' });
    row.createEl('span', { cls: 'tc-comment-date', text: 'Just now' });
    row.createEl('p', { cls: 'tc-comment-text', text });
    inputEl.value = '';
    inputEl.focus();

    // Write comment to vault file
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const today = window.moment().format('YYYY-MM-DD');
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const taskLine = lines[task.line];
      if (!taskLine) return data;
      const indent = (/^(\s*)/.exec(taskLine)?.[1] ?? '') + '  ';
      const commentLine = `${indent}- ${today}: ${text}`;
      const insertAt =
        'subtaskRange' in task && task.subtaskRange
          ? (task.subtaskRange as { to: number }).to + 1
          : task.line + 1;
      lines.splice(insertAt, 0, commentLine);
      return lines.join('\n');
    });
  }

  private async updateComment(
    task: TaskLike,
    comment: TaskComment,
    newText: string,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[comment.line];
      if (!line) return data;
      // Preserve date prefix if present
      const datePrefix = /^(\s*- \d{4}-\d{2}-\d{2}: )/.exec(line)?.[1];
      const barePrefix = /^(\s*- )/.exec(line)?.[1] ?? '';
      const prefix = datePrefix ?? barePrefix;
      lines[comment.line] = prefix + newText;
      return lines.join('\n');
    });
  }

  private async deleteComment(task: TaskLike, comment: TaskComment): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      lines.splice(comment.line, 1);
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
      const withDate = task.due
        ? line.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${date}`)
        : line.trimEnd() + ` 📅 ${date}`;
      lines[task.line] = formatTaskLine(withDate);
      return lines.join('\n');
    });
  }

  private async clearDate(task: Task): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      const stripped = line
        .replace(/[📅⏳🛫]\s*\d{4}-\d{2}-\d{2}/gu, '')
        .replace(/\s{2,}/gu, ' ')
        .trimEnd();
      lines[task.line] = formatTaskLine(stripped);
      return lines.join('\n');
    });
  }

  private async updatePriority(task: Task, priority: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const PRIORITY_EMOJIS = ['🔺', '⏫', '🔼', '🔽', '⏬'];
    const PRIORITY_MAP: Record<string, string> = { A: '🔺', B: '⏫', C: '🔼', E: '🔽', F: '⏬' };
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;
      let updated = line;
      for (const emoji of PRIORITY_EMOJIS) updated = updated.replace(emoji, '');
      if (priority !== 'C' && PRIORITY_MAP[priority])
        updated = updated.trimEnd() + ` ${PRIORITY_MAP[priority]}`;
      lines[task.line] = formatTaskLine(updated);
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
      const stripped = line
        .replace(new RegExp(`${escaped}(?![\\w/-])`, 'gu'), '')
        .replace(/\s{2,}/gu, ' ')
        .trimEnd();
      lines[task.line] = formatTaskLine(stripped);
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
      lines[task.line] = formatTaskLine(line.trimEnd() + ` ${tagStr}`);
      return lines.join('\n');
    });
  }

  private showTimePopover(anchor: HTMLElement, task: Task): void {
    const already = this.el.querySelector('.tc-time-popover');
    this.clearPopovers();
    if (already) return;

    const pop = this.el.createDiv({ cls: 'tc-popover tc-time-popover tc-popover-anchored' });
    // Use setCssProps for dynamic offset values (position/z-index are in the CSS class)
    pop.setCssProps({
      '--tc-pop-top': `${anchor.offsetTop + anchor.offsetHeight + 4}px`,
      '--tc-pop-left': `${anchor.offsetLeft}px`,
    });

    const inputRow = pop.createDiv({ cls: 'tc-popover-input-row' });
    const input = inputRow.createEl('input', {
      cls: 'tc-time-input',
      attr: { type: 'time', value: task.time ?? '' },
    });
    window.setTimeout(() => input.focus(), 0);
    input.addEventListener('change', () => {
      void this.updateTime(task, input.value).then(() => pop.remove());
    });
    input.addEventListener('blur', () => window.setTimeout(() => pop.remove(), 200));

    const clearBtn = inputRow.createEl('button', {
      cls: 'tc-popover-clear-icon-btn',
      attr: { title: 'Clear time', 'aria-label': 'Clear time' },
    });
    setIcon(clearBtn, 'x');
    clearBtn.addEventListener('mousedown', (e) => e.preventDefault());
    clearBtn.addEventListener('click', () => {
      void this.updateTime(task, '').then(() => pop.remove());
    });
  }

  private async updateTime(task: Task, time: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split('\n');
      const line = lines[task.line];
      if (!line) return data;

      const withoutTime = line.replace(/⏰\s*\d{1,2}:\d{2}/gu, '').replace(/\s{2,}/gu, ' ');
      const withTime = time ? `${withoutTime.trimEnd()} ⏰ ${time}` : withoutTime.trim();
      lines[task.line] = formatTaskLine(withTime);
      return lines.join('\n');
    });
  }

  private renderContextMenu(task: TaskLike, anchor: HTMLElement): void {
    // Toggle: if a menu is already open inside this anchor, close it
    const existing = anchor.querySelector('.tc-context-menu');
    if (existing) {
      existing.remove();
      return;
    }
    // Close any other open context menus
    this.el.querySelectorAll('.tc-context-menu').forEach((el) => el.remove());

    const menu = anchor.createDiv({ cls: 'tc-context-menu' });

    const deleteItem = menu.createDiv({
      cls: 'tc-context-item tc-context-danger',
      text: 'Delete task',
    });
    deleteItem.addEventListener('click', () => {
      menu.remove();
      void this.deleteTask(task);
    });

    const openItem = menu.createDiv({
      cls: 'tc-context-item',
      text: 'Open in file',
    });
    openItem.addEventListener('click', () => {
      menu.remove();
      void this.openInFile(task);
    });

    window.setTimeout(() => {
      const dismiss = (e: MouseEvent): void => {
        if (!menu.contains(e.target as Node) && e.target !== anchor) {
          menu.remove();
          activeDocument.removeEventListener('click', dismiss, true);
        }
      };
      activeDocument.addEventListener('click', dismiss, true);
    }, 0);
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
