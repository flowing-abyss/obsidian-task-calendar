import type { App } from 'obsidian';
import { AppState } from '../app/AppState';
import { RightPanel } from '../panels/RightPanel';
import type { Task } from '../parser/types';
import type { CalendarSettings } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';

export class TaskModal {
  private backdropEl: HTMLElement | null = null;
  private innerState: AppState | null = null;
  private innerPanel: RightPanel | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private ownerDoc: Document | null = null;
  private storeUnsub: (() => void) | null = null;

  constructor(
    private app: App,
    private settings?: CalendarSettings,
    private store?: TaskStore,
  ) {}

  open(task: Task): void {
    this.close();
    // Capture the active document at open time so close() removes from the same document
    this.ownerDoc = activeDocument;
    this.innerState = new AppState();
    this.innerState.set('taskStack', [task]);

    // Mirror PanelView's store-refresh wiring: without it, the modal's own AppState is
    // isolated from the TaskStore, so mutating Start/Plan (or any field) via RightPanel's
    // Planning disclosure updates the file/store but leaves this modal showing the stale
    // task object — RightPanel's Start/Plan chips (task.start / task.scheduled) then never
    // appear until the modal is closed and reopened.
    if (this.store) {
      this.storeUnsub = this.store.onUpdate(({ changedFiles }) => {
        const stack = this.innerState?.get('taskStack');
        if (!stack || stack.length === 0) return;
        const root = stack[0];
        if (!root || !changedFiles.includes(root.filePath)) return;
        const freshTasks = this.store!.getTasks();
        const freshRoot = freshTasks.find(
          (t) => t.filePath === root.filePath && t.line === root.line,
        );
        if (!freshRoot) return;
        if (stack.length === 1) {
          this.innerState?.set('taskStack', [freshRoot]);
          return;
        }
        // Rebuild deeper stack levels (subtask navigation), same approach as PanelView.
        const freshStack: typeof stack = [freshRoot];
        for (let i = 1; i < stack.length; i++) {
          const prev = freshStack[i - 1];
          const stale = stack[i];
          if (!prev || !stale) break;
          const freshSub = prev.subtasks?.find((s) => s.line === stale.line);
          if (!freshSub) break;
          freshStack.push(freshSub);
        }
        this.innerState?.set('taskStack', freshStack);
      });
    }

    const backdrop = this.ownerDoc.body.createDiv({ cls: 'tc-modal-backdrop' });
    this.backdropEl = backdrop;
    // Marks the document so hover-preview popovers can stack above the modal (see styles.css).
    this.ownerDoc.body.addClass('tc-modal-open');

    const modal = backdrop.createDiv({ cls: 'tc-modal' });

    const panelEl = modal.createDiv({ cls: 'tc-right tc-modal-body' });
    this.innerPanel = new RightPanel(this.innerState, this.app, this.settings);
    this.innerPanel.mount(panelEl);

    // Insert close button into the panel's header actions row (flex row, not absolutely positioned)
    const headerActions = panelEl.querySelector<HTMLElement>('.tc-right-header-actions');
    const closeBtn = activeDocument.createElement('button');
    closeBtn.className = 'tc-right-action-btn tc-modal-close-btn';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.setAttribute('title', 'Close');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());
    if (headerActions) {
      headerActions.appendChild(closeBtn);
    } else {
      panelEl.appendChild(closeBtn);
    }

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close();
    });

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    this.ownerDoc.addEventListener('keydown', this.keyHandler);
  }

  close(): void {
    if (this.keyHandler && this.ownerDoc) {
      this.ownerDoc.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.storeUnsub?.();
    this.storeUnsub = null;
    this.ownerDoc?.body.removeClass('tc-modal-open');
    this.ownerDoc = null;
    this.innerPanel?.destroy();
    this.innerPanel = null;
    this.innerState = null;
    this.backdropEl?.remove();
    this.backdropEl = null;
  }
}
