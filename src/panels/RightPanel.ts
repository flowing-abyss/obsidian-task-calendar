import type { App } from 'obsidian';
import { Component, setIcon } from 'obsidian';
import type { AppState } from '../app/AppState';
import { locatorOf, rewriteLinkInTask, TaskMutationService } from '../mutation';
import { rewriteNthLink, type LinkToken } from '../parser/links';
import { applySubtaskReorder } from '../parser/subtask-reorder';
import {
  formatDurationFromMinutes,
  formatTaskLine,
  insertIntoTitleBody,
  parseDurationToMinutes,
} from '../parser/TaskParser';
import type { SubTask, Task, TaskComment } from '../parser/types';
import { buildDefaultTaskStatuses } from '../settings/defaults';
import type { CalendarSettings } from '../settings/types';
import { StatusRegistry } from '../status/StatusRegistry';
import { colorForTag } from '../tags/tagColor';
import {
  enableAttachmentDrop,
  enableAttachmentPaste,
  insertAtCaret,
  whenPasteSettled,
} from '../ui/attachmentDrop';
import { LinkEditModal } from '../ui/LinkEditModal';
import { renderTaskText } from '../ui/renderTaskText';
import { renderStatusMarker } from '../ui/StatusMarker';
import { showStatusMenuAt } from '../ui/statusMenu';
import { showTagDropdown } from '../ui/tagDropdown';
import { openInFile } from '../ui/taskNavigation';

type TaskLike = Task | SubTask;

export class RightPanel {
  private el!: HTMLElement;
  private off?: () => void;
  private draggingSub: SubTask | null = null;
  private mutations: TaskMutationService;
  private statusRegistry: StatusRegistry;
  private md = new Component();

  constructor(
    private state: AppState,
    private app: App,
    private settings?: CalendarSettings,
  ) {
    this.statusRegistry = new StatusRegistry(
      this.settings?.taskStatuses ?? buildDefaultTaskStatuses(),
    );
    this.mutations = new TaskMutationService(app, () => this.statusRegistry);
  }

  mount(container: HTMLElement): void {
    this.el = container;
    this.off = this.state.on('taskStack', () => this.render());
    this.render();
  }

  destroy(): void {
    this.off?.();
    this.el?.empty();
    this.md.unload();
  }

  private render(): void {
    // Rebuild from current settings so a mid-session status edit (Settings tab) is
    // reflected immediately — RightPanel is constructed once and never otherwise refreshed.
    this.statusRegistry = new StatusRegistry(
      this.settings?.taskStatuses ?? buildDefaultTaskStatuses(),
    );
    this.md.unload();
    this.md = new Component();
    this.md.load();
    this.el.empty();
    const stack = this.state.get('taskStack');
    if (stack.length === 0) {
      this.renderEmpty();
      return;
    }
    const task = stack[stack.length - 1]!;
    this.renderTask(task, stack);
  }

  /** Wire clipboard paste-to-attach onto an editable textarea, inserting links at the caret. */
  private enablePaste(el: HTMLTextAreaElement, task: TaskLike): void {
    enableAttachmentPaste(el, {
      app: this.app,
      sourcePath: task.filePath,
      onInsert: (links) => insertAtCaret(el, links),
    });
  }

  private editLink(task: TaskLike, occ: number, token: LinkToken): void {
    new LinkEditModal(
      this.app,
      token,
      (newRaw) => {
        void rewriteLinkInTask(this.mutations, task, occ, newRaw);
      },
      task.filePath,
    ).open();
  }

  /**
   * Edit a link that lives inside a free-form string (a description or a comment),
   * rewriting the Nth occurrence within that string and persisting via `save`.
   */
  private editLinkInString(
    source: string,
    occ: number,
    token: LinkToken,
    sourcePath: string,
    save: (newText: string) => void,
  ): void {
    new LinkEditModal(
      this.app,
      token,
      (newRaw) => save(rewriteNthLink(source, occ, newRaw)),
      sourcePath,
    ).open();
  }

  /** Description block: rendered markdown (clickable links) that becomes a textarea on click. */
  private renderDescriptionBlock(section: HTMLElement, task: TaskLike): void {
    const view = section.createDiv({ cls: 'tc-right-desc tc-right-desc-view' });
    enableAttachmentDrop(view, {
      app: this.app,
      sourcePath: task.filePath,
      onLinks: (links) => {
        // Reads the closure-captured description snapshot; updateDescription rewrites the
        // whole block from it. Safe for normal single-drop use (the panel isn't re-rendered
        // mid-drag); a concurrent external edit landing mid-drag is the only stale case.
        const cur = task.description ?? '';
        void this.updateDescription(task, cur.trim() ? `${cur} ${links}` : links);
      },
    });
    let showView: () => void = () => {};

    const enterEdit = (): void => {
      const start = view.offsetHeight;
      view.hide();
      const ta = section.createEl('textarea', { cls: 'tc-right-desc tc-right-desc-edit' });
      view.insertAdjacentElement('afterend', ta);
      ta.value = task.description ?? '';
      this.enablePaste(ta, task);
      ta.setCssStyles({ height: `${Math.max(start, 60)}px` });
      window.setTimeout(() => ta.focus(), 0);
      let done = false;
      const finish = async (save: boolean): Promise<void> => {
        if (done) return;
        // Let any in-flight paste insert its link into the value before we save/remove.
        await whenPasteSettled(ta);
        if (done) return;
        done = true;
        if (save && ta.value !== (task.description ?? '')) {
          void this.updateDescription(task, ta.value);
        }
        ta.remove();
        view.show();
        showView();
      };
      ta.addEventListener('blur', () => void finish(true));
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          void finish(false);
        }
      });
    };

    showView = (): void => {
      const desc = task.description ?? '';
      if (desc.trim()) {
        view.removeClass('tc-right-desc-empty');
        renderTaskText(view, desc, {
          app: this.app,
          sourcePath: task.filePath,
          component: this.md,
          onEditLink: (occ, token) =>
            this.editLinkInString(
              desc,
              occ,
              token,
              task.filePath,
              (t) => void this.updateDescription(task, t),
            ),
        });
      } else {
        view.empty();
        view.addClass('tc-right-desc-empty');
        view.setText('Add a description…');
      }
    };

    view.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) return; // let links navigate
      enterEdit();
    });
    showView();
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
    // Breadcrumb — shows only the parent path (current task is in the title input)
    if (stack.length > 1) {
      const breadcrumb = this.el.createDiv({ cls: 'tc-breadcrumb' });
      const parents = stack.slice(0, -1);
      parents.forEach((item, idx) => {
        if (idx > 0) breadcrumb.createEl('span', { cls: 'tc-breadcrumb-sep', text: ' › ' });
        const crumb = breadcrumb.createEl('span', { cls: 'tc-breadcrumb-item' });
        renderTaskText(crumb, item.markdownText, {
          app: this.app,
          sourcePath: item.filePath,
          component: this.md,
          onEditLink: (occ, token) => this.editLink(item, occ, token),
        });
        crumb.addEventListener('click', () => {
          this.state.set('taskStack', stack.slice(0, idx + 1));
        });
      });
    }

    // Header
    const header = this.el.createDiv({ cls: 'tc-right-header' });
    this.renderTitleBlock(header, task);

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

    // Metadata chips — available for both Task and SubTask
    {
      const chips = this.el.createDiv({ cls: 'tc-chips-row' });

      // Date chip (due-first display; if scheduled is set, prefer showing scheduled as the
      // "when this sits on the calendar" chip, matching the due-centric anchor-priority rule)
      this.renderDateChip(chips, task);

      // Combined time + duration chip (duration only applies to top-level Task, not SubTask)
      const duration = 'duration' in task ? task.duration : undefined;
      let timeChipText = '⏰';
      if (task.time) {
        timeChipText = duration
          ? `⏰ ${task.time} · ${formatDurationFromMinutes(duration)}`
          : `⏰ ${task.time}`;
      }
      const timeChip = chips.createEl('button', {
        cls: `tc-chip tc-chip-time${task.time ? '' : ' tc-chip-empty'}`,
        text: timeChipText,
        attr: { title: 'Set time & duration' },
      });
      timeChip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showTimePopover(timeChip, task);
      });

      // Priority chip
      this.renderPriorityChip(chips, task);

      // Scheduled ("Plan") and Start chips — once SET, rendered as a normal round-pill,
      // same style as the date/time/priority chips above; clicking it opens the same small
      // date-picker popover used for the due-date chip (showDatePopover, generalized with a
      // `field` param below). While UNSET, no placeholder pill clutters the main row —
      // instead a compact "+" control (mirroring the "+ tag" button's pattern) offers to
      // add whichever of Start/Plan are currently unset; picking one opens the exact same
      // popover. This intentionally reverses the "always-visible placeholder pill" unset
      // treatment from the previous round after live testing showed it cluttered the row.
      if (task.scheduled) this.renderScheduledChip(chips, task);
      if (task.start) this.renderStartChip(chips, task);
      this.renderAddDateMenu(chips, task);

      // Tag chips
      const tags = task.rawText.match(/#[\w/-]+/gu) ?? [];
      for (const tag of tags) {
        this.renderTagChip(chips, task, tag);
      }
      // Add tag
      const addTagBtn = chips.createEl('button', { cls: 'tc-chip tc-chip-add', text: '+ tag' });
      addTagBtn.addEventListener('click', () => {
        addTagBtn.addClass('tc-chip-add--hidden');
        this.showTagInput(chips, task, addTagBtn, () =>
          addTagBtn.removeClass('tc-chip-add--hidden'),
        );
      });
    }

    // Divider
    this.el.createDiv({ cls: 'tc-right-divider' });

    // Description
    const descSection = this.el.createDiv({ cls: 'tc-right-section' });
    const descHeader = descSection.createDiv({ cls: 'tc-right-section-header' });
    descHeader.createEl('span', { cls: 'tc-right-section-label', text: 'Description' });
    this.renderDescriptionBlock(descSection, task);

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
      this.renderSubTask(subList, sub, task);
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
    enableAttachmentDrop(commentInput, {
      app: this.app,
      sourcePath: task.filePath,
      onLinks: (links) => {
        commentInput.value = commentInput.value ? `${commentInput.value} ${links}` : links;
        commentInput.focus();
      },
    });
    this.enablePaste(commentInput, task);
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

  private renderTitleBlock(header: HTMLElement, task: TaskLike): void {
    const view = header.createDiv({ cls: 'tc-right-title tc-right-title-view' });
    enableAttachmentDrop(view, {
      app: this.app,
      sourcePath: task.filePath,
      onLinks: (links) => void this.appendToTitle(task, links),
    });
    const renderView = (): void => {
      renderTaskText(view, task.markdownText, {
        app: this.app,
        sourcePath: task.filePath,
        component: this.md,
        onEditLink: (occ, token) => this.editLink(task, occ, token),
      });
    };
    renderView();

    // Click on empty space / non-link text enters edit mode.
    view.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) return; // let links navigate
      this.enterTitleEdit(header, view, task, renderView);
    });
  }

  private enterTitleEdit(
    header: HTMLElement,
    view: HTMLElement,
    task: TaskLike,
    renderView: () => void,
  ): void {
    // Preserve the height the user stretched the read-mode block to (measure first).
    const startHeight = view.offsetHeight;
    view.hide();
    const ta = header.createEl('textarea', { cls: 'tc-right-title tc-right-title-edit' });
    // Keep the textarea in the title's slot so the ⋯/× action buttons stay on the right.
    view.insertAdjacentElement('afterend', ta);
    ta.value = task.markdownText;
    this.enablePaste(ta, task);
    // Auto-grow to content, but never below the stretched height.
    const grow = (): void => {
      ta.setCssStyles({ height: 'auto' });
      ta.setCssStyles({ height: `${Math.max(ta.scrollHeight, startHeight)}px` });
    };
    ta.addEventListener('input', grow);
    window.setTimeout(() => {
      ta.focus();
      grow();
    }, 0);

    let done = false;
    const finish = async (save: boolean): Promise<void> => {
      if (done) return;
      // Let any in-flight paste insert its link into the value before we save/remove.
      await whenPasteSettled(ta);
      if (done) return;
      done = true;
      // Carry the current height back to the read-mode block so the stretch persists.
      view.setCssStyles({ height: `${ta.offsetHeight}px` });
      if (save && ta.value !== task.markdownText) {
        void this.updateTaskTitle(task, ta.value.trim());
      }
      ta.remove();
      view.show();
      renderView();
    };
    ta.addEventListener('blur', () => void finish(true));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void finish(true);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        void finish(false);
      }
    });
  }

  private renderSubTask(container: HTMLElement, sub: SubTask, parentTask: TaskLike): void {
    const row = container.createDiv({ cls: 'tc-subtask-row', attr: { draggable: 'true' } });

    // ── Drag-and-drop ─────────────────────────────────────────
    row.addEventListener('dragstart', (e) => {
      this.draggingSub = sub;
      row.addClass('is-dragging');
      e.dataTransfer?.setData('text/plain', String(sub.line));
    });

    row.addEventListener('dragend', () => {
      this.draggingSub = null;
      row.removeClass('is-dragging');
      // Clean up any lingering indicators across all rows
      container.querySelectorAll('.drop-above,.drop-below').forEach((el) => {
        el.removeClass('drop-above');
        el.removeClass('drop-below');
      });
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!this.draggingSub || this.draggingSub.line === sub.line) return;
      const rect = row.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      // Clear indicators on all siblings first
      container.querySelectorAll('.drop-above,.drop-below').forEach((el) => {
        el.removeClass('drop-above');
        el.removeClass('drop-below');
      });
      row.addClass(isAbove ? 'drop-above' : 'drop-below');
    });

    row.addEventListener('dragleave', (e) => {
      if (!row.contains(e.relatedTarget as Node)) {
        row.removeClass('drop-above');
        row.removeClass('drop-below');
      }
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const dragged = this.draggingSub;
      if (!dragged || dragged.line === sub.line) return;
      const position = row.hasClass('drop-above') ? 'before' : 'after';
      row.removeClass('drop-above');
      row.removeClass('drop-below');
      void this.reorderSubTask(parentTask, dragged, sub, position);
    });

    // ── Status marker ─────────────────────────────────────────
    renderStatusMarker(row, {
      task: sub,
      registry: this.statusRegistry,
      onLeftClick: () => void this.toggleSubTask(sub),
      onContextMenu: (ev) => {
        ev.stopPropagation();
        const today = window.moment().format('YYYY-MM-DD');
        showStatusMenuAt(ev, {
          task: sub,
          registry: this.statusRegistry,
          onPickStatus: (c) => void this.mutations.setStatusChar(locatorOf(sub), c, today),
          onPickPriority: (p) => void this.updatePriority(sub, p),
        });
      },
    });

    // ── Content ───────────────────────────────────────────────
    const content = row.createDiv({ cls: 'tc-subtask-content' });
    const label = content.createEl('span', {
      cls: `tc-subtask-label${sub.status === 'done' ? ' is-done' : ''}`,
    });
    renderTaskText(label, sub.markdownText, {
      app: this.app,
      sourcePath: sub.filePath,
      component: this.md,
      onEditLink: (occ, token) => this.editLink(sub, occ, token),
    });
    label.addEventListener('click', () => {
      const stack = this.state.get('taskStack');
      this.state.set('taskStack', [...stack, sub]);
    });

    // Progress + comment count indicators
    const subCount = sub.subtasks?.length ?? 0;
    const commentCount = sub.comments?.length ?? 0;
    if (subCount > 0 || commentCount > 0) {
      const subMeta = content.createDiv({ cls: 'tc-subtask-meta' });
      if (subCount > 0) {
        const done = sub.subtasks!.filter((s) => s.status === 'done').length;
        subMeta.createEl('span', { cls: 'tc-subtask-progress', text: `${done}/${subCount}` });
      }
      if (commentCount > 0) {
        subMeta.createEl('span', { cls: 'tc-subtask-comment-count', text: `💬 ${commentCount}` });
      }
    }
  }

  private renderComment(container: HTMLElement, comment: TaskComment, task: TaskLike): void {
    const row = container.createDiv({ cls: 'tc-comment-row' });
    enableAttachmentDrop(row, {
      app: this.app,
      sourcePath: task.filePath,
      onLinks: (links) => void this.updateComment(task, comment, `${comment.text} ${links}`.trim()),
    });
    if (comment.date) {
      const m = window.moment(comment.date, 'YYYY-MM-DD');
      const diff = m.diff(window.moment(), 'days');
      const label = Math.abs(diff) < 7 ? m.fromNow() : m.format('D MMM YYYY');
      row.createEl('span', { cls: 'tc-comment-date', text: label });
    }
    let showText: () => void = () => {};

    const enterEdit = (): void => {
      row.querySelector('.tc-comment-text')?.remove();
      const textarea = row.createEl('textarea', { cls: 'tc-comment-edit-input' });
      textarea.value = comment.text;
      this.enablePaste(textarea, task);
      textarea.focus();
      textarea.select();
      let saved = false;
      const finish = async (): Promise<void> => {
        if (saved) return;
        // Let any in-flight paste insert its link into the value before we save/remove.
        await whenPasteSettled(textarea);
        if (saved) return;
        saved = true;
        const val = textarea.value.trim();
        textarea.remove();
        if (val === '') {
          this.deleteComment(task, comment).catch(() => showText());
        } else if (val !== comment.text) {
          this.updateComment(task, comment, val).catch(() => showText());
        } else {
          showText();
        }
      };
      textarea.addEventListener('blur', () => window.setTimeout(() => void finish(), 150));
      textarea.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          textarea.blur();
        }
        if (e.key === 'Escape') {
          saved = true;
          textarea.remove();
          showText();
        }
      });
    };

    showText = (): void => {
      const textEl = row.createEl('p', { cls: 'tc-comment-text' });
      renderTaskText(textEl, comment.text, {
        app: this.app,
        sourcePath: task.filePath,
        component: this.md,
        onEditLink: (occ, token) =>
          this.editLinkInString(
            comment.text,
            occ,
            token,
            task.filePath,
            (t) => void this.updateComment(task, comment, t),
          ),
      });
      textEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('a')) return; // let links navigate
        enterEdit();
      });
    };

    showText();
  }

  private renderDateChip(container: HTMLElement, task: TaskLike): void {
    const d = task.due ?? task.scheduled;
    const chip = container.createEl('button', {
      cls: `tc-chip${d ? '' : ' tc-chip-empty'}`,
      text: d ? `📅 ${this.formatDate(d)}` : '📅 Date',
    });
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showDatePopover(chip, task, 'due');
    });
  }

  /** "Plan" (⏳/`scheduled`) chip — same round-pill/popover pattern as the due-date chip. */
  private renderScheduledChip(container: HTMLElement, task: TaskLike): void {
    const value = task.scheduled;
    const chip = container.createEl('button', {
      cls: `tc-chip tc-chip-scheduled${value ? '' : ' tc-chip-empty'}`,
      text: value ? `⏳ ${this.formatDate(value)}` : '⏳ Plan',
      attr: { title: 'Set plan date' },
    });
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showDatePopover(chip, task, 'scheduled');
    });
  }

  /** "Start" (🛫/`start`) chip — same round-pill/popover pattern as the due-date chip. */
  private renderStartChip(container: HTMLElement, task: TaskLike): void {
    const value = task.start;
    const chip = container.createEl('button', {
      cls: `tc-chip tc-chip-start${value ? '' : ' tc-chip-empty'}`,
      text: value ? `🛫 ${this.formatDate(value)}` : '🛫 Start',
      attr: { title: 'Set start date' },
    });
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showDatePopover(chip, task, 'start');
    });
  }

  /**
   * Compact "+"-style control offering to add whichever of Start/Plan are currently unset —
   * mirrors the "+ tag" button's pattern (small affordance that reveals a chooser) rather than
   * an always-visible placeholder pill. Renders nothing once both are already set (nothing left
   * to offer), and remains extensible for future addable properties (e.g. recurrence).
   */
  private renderAddDateMenu(container: HTMLElement, task: TaskLike): void {
    const options: Array<{ field: 'start' | 'scheduled'; label: string }> = [];
    if (!task.start) options.push({ field: 'start', label: '🛫 Start' });
    if (!task.scheduled) options.push({ field: 'scheduled', label: '⏳ Plan' });
    if (options.length === 0) return;

    const addBtn = container.createEl('button', {
      cls: 'tc-chip tc-chip-add tc-chip-add-date',
      text: '+ date',
      attr: { title: 'Add start or plan date', 'aria-label': 'Add start or plan date' },
    });
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showAddDateMenu(addBtn, task, options);
    });
  }

  /** Small menu anchored to the "+ date" button — clicking an option opens showDatePopover. */
  private showAddDateMenu(
    anchor: HTMLElement,
    task: TaskLike,
    options: Array<{ field: 'start' | 'scheduled'; label: string }>,
  ): void {
    const existing = anchor.querySelector('.tc-add-date-menu');
    if (existing) {
      existing.remove();
      return;
    }
    this.el.querySelectorAll('.tc-add-date-menu').forEach((el) => el.remove());
    this.el.querySelectorAll('.tc-context-menu').forEach((el) => el.remove());

    const menu = anchor.createDiv({ cls: 'tc-context-menu tc-add-date-menu' });
    for (const opt of options) {
      const item = menu.createDiv({
        cls: 'tc-context-item tc-add-date-menu-item',
        text: opt.label,
      });
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.remove();
        this.showDatePopover(anchor, task, opt.field);
      });
    }

    this.dismissMenuOnOutsideClick(menu, anchor);
  }

  private renderPriorityChip(container: HTMLElement, task: TaskLike): void {
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

  private renderTagChip(container: HTMLElement, task: TaskLike, tag: string): void {
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
    return colorForTag(tag, this.settings.tagGroups);
  }

  private clearPopovers(): void {
    this.el.querySelectorAll('.tc-popover').forEach((el) => el.remove());
  }

  /**
   * Small date-picker popover shared by the due/plan/start chips. `field` selects which
   * metadata date is being edited — the popover markup, positioning, and clear-button
   * behavior are identical for all three; only the read/write pair differs.
   */
  private showDatePopover(
    anchor: HTMLElement,
    task: TaskLike,
    field: 'due' | 'scheduled' | 'start' = 'due',
  ): void {
    const already = this.el.querySelector('.tc-date-popover');
    this.clearPopovers();
    if (already) return;

    const pop = this.el.createDiv({ cls: 'tc-popover tc-date-popover tc-popover-anchored' });

    let currentValue: string | undefined;
    if (field === 'due') currentValue = task.due ?? task.scheduled;
    else if (field === 'scheduled') currentValue = task.scheduled;
    else currentValue = task.start;

    const inputRow = pop.createDiv({ cls: 'tc-popover-input-row' });
    const input = inputRow.createEl('input', {
      cls: 'tc-date-input',
      attr: { type: 'date', value: currentValue ?? '' },
    });
    input.addEventListener('change', () => {
      if (field === 'due') void this.updateDue(task, input.value);
      else if (field === 'scheduled') void this.updateScheduled(task, input.value);
      else void this.updateStart(task, input.value);
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
      if (field === 'due') void this.clearDate(task);
      else if (field === 'scheduled') void this.clearScheduled(task);
      else void this.clearStart(task);
      pop.remove();
    });
    this.positionAnchoredPopover(pop, anchor);
  }

  private showPriorityPopover(anchor: HTMLElement, task: TaskLike): void {
    const already = this.el.querySelector('.tc-priority-popover');
    this.clearPopovers();
    if (already) return;

    const pop = this.el.createDiv({ cls: 'tc-popover tc-priority-popover tc-popover-anchored' });

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
      const isActive = currentPriority === opt.value;
      const btn = pop.createEl('button', {
        cls: `tc-priority-option${isActive ? ' is-active' : ''}`,
        attr: { 'data-priority': opt.value },
      });
      const checkEl = btn.createEl('span', { cls: 'tc-priority-option-check' });
      if (isActive) setIcon(checkEl, 'check');
      const flagEl = btn.createEl('span', { cls: 'tc-priority-option-flag' });
      setIcon(flagEl, 'flag');
      btn.createEl('span', { cls: 'tc-priority-option-label', text: opt.label });
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
    this.positionAnchoredPopover(pop, anchor);
    window.setTimeout(() => {
      this.el.addEventListener('click', () => pop.remove(), { once: true });
    }, 0);
  }

  private positionAnchoredPopover(popover: HTMLElement, anchor: HTMLElement): void {
    const panelWidth = this.el.getBoundingClientRect().width || this.el.clientWidth;
    const minWidth = parseFloat(getComputedStyle(popover).minWidth);
    const popoverWidth =
      popover.offsetWidth ||
      popover.getBoundingClientRect().width ||
      (Number.isFinite(minWidth) ? minWidth : 160);
    const edgeGap = this.cssLengthToPx(
      getComputedStyle(popover).getPropertyValue('--tc-popover-edge-gap'),
      popover,
      8,
    );
    const anchorGap = this.cssLengthToPx(
      getComputedStyle(popover).getPropertyValue('--tc-popover-anchor-gap'),
      popover,
      4,
    );
    const maxLeft =
      panelWidth > 0 ? Math.max(edgeGap, panelWidth - popoverWidth - edgeGap) : anchor.offsetLeft;
    const left = Math.min(Math.max(anchor.offsetLeft, edgeGap), maxLeft);

    popover.style.setProperty(
      '--tc-pop-top',
      `${anchor.offsetTop + anchor.offsetHeight + anchorGap}px`,
    );
    popover.style.setProperty('--tc-pop-left', `${left}px`);
  }

  private cssLengthToPx(value: string, relativeTo: HTMLElement, fallback: number): number {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (trimmed.endsWith('px')) return parseFloat(trimmed);
    if (trimmed.endsWith('rem')) {
      const rootFontSize =
        parseFloat(getComputedStyle(activeDocument.documentElement).fontSize) || 16;
      return parseFloat(trimmed) * rootFontSize;
    }
    if (trimmed.endsWith('em')) {
      const fontSize = parseFloat(getComputedStyle(relativeTo).fontSize) || 16;
      return parseFloat(trimmed) * fontSize;
    }
    const numeric = parseFloat(trimmed);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  private showTagInput(
    container: HTMLElement,
    task: TaskLike,
    _anchor: HTMLElement,
    onClose?: () => void,
  ): void {
    showTagDropdown(
      container,
      this.app,
      (tag) => this.getTagColor(tag),
      (tag) => void this.addTag(task, tag),
      onClose,
    );
  }

  // ---- Write-back helpers ----

  private async updateTaskTitle(task: TaskLike, newText: string): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const prefixMatch = /^([\s>]*- \[[ xX/]\] )/.exec(line);
      if (!prefixMatch) return;
      const prefix = prefixMatch[1] ?? '';
      const rawAfterPrefix = line.slice(prefix.length);
      const spaceIdx = rawAfterPrefix.search(/\s[📅⏳🛫✅❌⏰🔁🔺⏫🔼🔽⏬#➕]/u);
      const suffix = spaceIdx >= 0 ? rawAfterPrefix.slice(spaceIdx) : '';
      lines[taskLine] = formatTaskLine(prefix + newText + suffix);
    });
  }

  private async appendToTitle(task: TaskLike, text: string): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      lines[taskLine] = insertIntoTitleBody(line, text);
    });
  }

  private async updateDescription(task: TaskLike, newDesc: string): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const tl = lines[taskLine];
      if (!tl) return;
      // Leading prefix includes blockquote/callout markers so nested items stay
      // inside the quote (e.g. "> - [ ]" → child ">   - [ ]").
      const indent = (/^([\s>]*)/.exec(tl)?.[1] ?? '') + '  ';

      const delta = taskLine - task.line;
      const rangeStart = task.subtaskRange ? task.subtaskRange.from + delta : taskLine + 1;
      const rangeEnd = task.subtaskRange ? task.subtaskRange.to + delta : taskLine;

      const before = lines.slice(0, rangeStart);
      const inside = lines.slice(rangeStart, rangeEnd + 1).filter((l) => !/^[\s>]*- > /.test(l));
      const after = lines.slice(rangeEnd + 1);

      const descLines = newDesc.trim()
        ? newDesc
            .split('\n')
            .filter(Boolean)
            .map((l) => `${indent}- > ${l}`)
        : [];

      lines.splice(0, lines.length, ...before, ...descLines, ...inside, ...after);
    });
  }

  private async addSubTask(task: TaskLike, text: string): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const tl = lines[taskLine];
      if (!tl) return;
      // Leading prefix includes blockquote/callout markers so nested items stay
      // inside the quote (e.g. "> - [ ]" → child ">   - [ ]").
      const indent = (/^([\s>]*)/.exec(tl)?.[1] ?? '') + '  ';
      const newLine = `${indent}- [ ] ${text}`;
      const delta = taskLine - task.line;
      const insertAt = task.subtaskRange ? task.subtaskRange.to + delta + 1 : taskLine + 1;
      lines.splice(insertAt, 0, newLine);
    });
  }

  private async toggleSubTask(sub: SubTask): Promise<void> {
    const isDone = this.statusRegistry.typeForSymbol(sub.statusSymbol) === 'done';
    const targetSymbol = isDone
      ? this.statusRegistry.defaultTodo().symbol
      : this.statusRegistry.defaultDone().symbol;
    const today = window.moment().format('YYYY-MM-DD');
    await this.mutations.setStatusChar(locatorOf(sub), targetSymbol, today);
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

    const today = window.moment().format('YYYY-MM-DD');
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const tl = lines[taskLine];
      if (!tl) return;
      // Leading prefix includes blockquote/callout markers so nested items stay
      // inside the quote (e.g. "> - [ ]" → child ">   - [ ]").
      const indent = (/^([\s>]*)/.exec(tl)?.[1] ?? '') + '  ';
      const commentLine = `${indent}- ${today}: ${text}`;
      const delta = taskLine - task.line;
      const insertAt =
        'subtaskRange' in task && task.subtaskRange
          ? (task.subtaskRange as { to: number }).to + delta + 1
          : taskLine + 1;
      lines.splice(insertAt, 0, commentLine);
    });
  }

  private async updateComment(
    task: TaskLike,
    comment: TaskComment,
    newText: string,
  ): Promise<void> {
    // Anchor on the task via rawText; adjust comment position by the same line drift.
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const delta = taskLine - task.line;
      const commentIdx = comment.line + delta;
      const line = lines[commentIdx];
      if (!line) return;
      const datePrefix = /^([\s>]*- \d{4}-\d{2}-\d{2}: )/.exec(line)?.[1];
      const barePrefix = /^([\s>]*- )/.exec(line)?.[1] ?? '';
      const prefix = datePrefix ?? barePrefix;
      lines[commentIdx] = prefix + newText;
    });
  }

  private async deleteComment(task: TaskLike, comment: TaskComment): Promise<void> {
    // Anchor on the task via rawText; adjust comment position by the same line drift.
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const delta = taskLine - task.line;
      lines.splice(comment.line + delta, 1);
    });
  }

  private async updateDue(task: TaskLike, date: string): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const withDate = task.due
        ? line.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, `📅 ${date}`)
        : line.trimEnd() + ` 📅 ${date}`;
      lines[taskLine] = formatTaskLine(withDate);
    });
  }

  private async clearDate(task: TaskLike): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const stripped = line
        .replace(/[📅⏳🛫]\s*\d{4}-\d{2}-\d{2}/gu, '')
        .replace(/\s{2,}/gu, ' ')
        .trimEnd();
      lines[taskLine] = formatTaskLine(stripped);
    });
  }

  private async updateScheduled(task: TaskLike, date: string): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const withDate = task.scheduled
        ? line.replace(/⏳\s*\d{4}-\d{2}-\d{2}/u, `⏳ ${date}`)
        : line.trimEnd() + ` ⏳ ${date}`;
      lines[taskLine] = formatTaskLine(withDate);
    });
  }

  private async clearScheduled(task: TaskLike): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const stripped = line
        .replace(/⏳\s*\d{4}-\d{2}-\d{2}/u, '')
        .replace(/\s{2,}/gu, ' ')
        .trimEnd();
      lines[taskLine] = formatTaskLine(stripped);
    });
  }

  private async updateStart(task: TaskLike, date: string): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const withDate = task.start
        ? line.replace(/🛫\s*\d{4}-\d{2}-\d{2}/u, `🛫 ${date}`)
        : line.trimEnd() + ` 🛫 ${date}`;
      lines[taskLine] = formatTaskLine(withDate);
    });
  }

  private async clearStart(task: TaskLike): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const stripped = line
        .replace(/🛫\s*\d{4}-\d{2}-\d{2}/u, '')
        .replace(/\s{2,}/gu, ' ')
        .trimEnd();
      lines[taskLine] = formatTaskLine(stripped);
    });
  }

  private async updateDuration(task: Task, minutes: number): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const token = `⏱️ ${formatDurationFromMinutes(minutes)}`;
      const withDuration = task.duration
        ? line.replace(/⏱️\s*(?:\d+h)?(?:\d+m)?/u, token)
        : line.trimEnd() + ` ${token}`;
      lines[taskLine] = formatTaskLine(withDuration);
    });
  }

  private async clearDuration(task: Task): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const stripped = line
        .replace(/⏱️\s*(?:\d+h)?(?:\d+m)?/u, '')
        .replace(/\s{2,}/gu, ' ')
        .trimEnd();
      lines[taskLine] = formatTaskLine(stripped);
    });
  }

  private async updatePriority(task: TaskLike, priority: string): Promise<void> {
    const PRIORITY_EMOJIS = ['🔺', '⏫', '🔼', '🔽', '⏬'];
    const PRIORITY_MAP: Record<string, string> = { A: '🔺', B: '⏫', C: '🔼', E: '🔽', F: '⏬' };
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      let updated = line;
      for (const emoji of PRIORITY_EMOJIS) updated = updated.replace(emoji, '');
      if (priority !== 'D' && PRIORITY_MAP[priority])
        updated = updated.trimEnd() + ` ${PRIORITY_MAP[priority]}`;
      lines[taskLine] = formatTaskLine(updated);
    });
  }

  private async removeTag(task: TaskLike, tag: string): Promise<void> {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const stripped = line
        .replace(new RegExp(`${escaped}(?![\\w/-])`, 'gu'), '')
        .replace(/\s{2,}/gu, ' ')
        .trimEnd();
      lines[taskLine] = formatTaskLine(stripped);
    });
  }

  private async addTag(task: TaskLike, tag: string): Promise<void> {
    const tagStr = tag.startsWith('#') ? tag : `#${tag}`;
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      lines[taskLine] = formatTaskLine(line.trimEnd() + ` ${tagStr}`);
    });
  }

  private showTimePopover(anchor: HTMLElement, task: TaskLike): void {
    const already = this.el.querySelector('.tc-time-popover');
    this.clearPopovers();
    if (already) return;

    const pop = this.el.createDiv({ cls: 'tc-popover tc-time-popover tc-popover-anchored' });

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

    // Duration only applies to top-level Task (SubTask has no duration field) —
    // same 'duration' in task discriminator used for the Planning section gate.
    if ('duration' in task) {
      const durationRow = pop.createDiv({ cls: 'tc-popover-input-row' });
      const durationInput = durationRow.createEl('input', {
        cls: 'tc-duration-input',
        attr: {
          type: 'text',
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          placeholder: 'Duration, e.g. 1h30m',
          value: task.duration ? formatDurationFromMinutes(task.duration) : '',
        },
      });
      durationInput.addEventListener('change', () => {
        const minutes = parseDurationToMinutes(durationInput.value);
        const done = minutes ? this.updateDuration(task, minutes) : this.clearDuration(task);
        void done.then(() => pop.remove());
      });
      durationInput.addEventListener('blur', () => window.setTimeout(() => pop.remove(), 200));

      const clearDurationBtn = durationRow.createEl('button', {
        cls: 'tc-popover-clear-icon-btn',
        attr: { title: 'Clear duration', 'aria-label': 'Clear duration' },
      });
      setIcon(clearDurationBtn, 'x');
      clearDurationBtn.addEventListener('mousedown', (e) => e.preventDefault());
      clearDurationBtn.addEventListener('click', () => {
        void this.clearDuration(task).then(() => pop.remove());
      });
    }

    this.positionAnchoredPopover(pop, anchor);
  }

  private async updateTime(task: TaskLike, time: string): Promise<void> {
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      const withoutTime = line.replace(/⏰\s*\d{1,2}:\d{2}/gu, '').replace(/\s{2,}/gu, ' ');
      const withTime = time ? `${withoutTime.trimEnd()} ⏰ ${time}` : withoutTime.trim();
      lines[taskLine] = formatTaskLine(withTime);
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
      void openInFile(this.app, task);
    });

    this.dismissMenuOnOutsideClick(menu, anchor);
  }

  /** Shared outside-click dismissal for small anchored menus (context menu, add-date menu). */
  private dismissMenuOnOutsideClick(menu: HTMLElement, anchor: HTMLElement): void {
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
    const rangeEnd = 'subtaskRange' in task && task.subtaskRange ? task.subtaskRange.to : task.line;
    const result = await this.mutations.deleteTaskBlock(locatorOf(task), rangeEnd);
    if (result.type === 'ok') {
      this.state.set('taskStack', []);
    }
  }

  private async reorderSubTask(
    _parentTask: TaskLike,
    moved: SubTask,
    target: SubTask,
    position: 'before' | 'after',
  ): Promise<void> {
    // applySubtaskReorder operates on the full content string; use applyToLines with
    // a full-array splice to apply it after confirming the anchor task is still present.
    await this.mutations.applyToLines(locatorOf(moved), (lines, taskLine) => {
      const delta = taskLine - moved.line;
      const content = lines.join('\n');
      const updated = applySubtaskReorder(
        content,
        { line: moved.line + delta, rangeTo: (moved.subtaskRange?.to ?? moved.line) + delta },
        { line: target.line + delta, rangeTo: (target.subtaskRange?.to ?? target.line) + delta },
        position,
      );
      const newLines = updated.split('\n');
      lines.splice(0, lines.length, ...newLines);
    });
  }

  private formatDate(d: string): string {
    const today = window.moment().format('YYYY-MM-DD');
    const tomorrow = window.moment().add(1, 'day').format('YYYY-MM-DD');
    if (d === today) return 'Today';
    if (d === tomorrow) return 'Tomorrow';
    return window.moment(d, 'YYYY-MM-DD').format('D MMM');
  }
}
