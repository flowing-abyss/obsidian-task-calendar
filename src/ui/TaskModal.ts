import type { App } from 'obsidian';
import { AppState } from '../app/AppState';
import { RightPanel } from '../panels/RightPanel';
import type { SubTask, Task } from '../parser/types';
import type { CalendarSettings } from '../settings/types';
import type { TaskApplicationApi, TaskIndexEvent, TaskQueryApi, TaskResolution } from '../tasks';
import { legacyTaskView, rebuildLegacyTaskStack, taskRefOf } from '../tasks/compat/legacyTaskView';
import type { TaskRef } from '../tasks/domain/types';

export class TaskModal {
  private backdropEl: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;
  private innerState: AppState | null = null;
  private innerPanel: RightPanel | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private ownerDoc: Document | null = null;
  private storeUnsub: (() => void) | null = null;
  private selectionUnsub: (() => void) | null = null;
  private ownedWriteRef: TaskRef | undefined = undefined;

  constructor(
    private app: App,
    private settings?: CalendarSettings,
    _store?: unknown,
    private queries?: TaskQueryApi,
    private tasks?: TaskApplicationApi,
  ) {}

  open(task: Task): void {
    this.close();
    // Capture the active document at open time so close() removes from the same document
    this.ownerDoc = activeDocument;
    this.innerState = new AppState();
    this.innerState.set('taskStack', [task]);
    this.selectionUnsub = this.innerState.on('taskStack', (stack) => {
      if (!this.ownedWriteRef) return;
      const ref = stack[0] ? taskRefOf(stack[0]) : undefined;
      if (!ref || !this.sameRef(ref, this.ownedWriteRef)) this.ownedWriteRef = undefined;
    });

    // Mirror PanelView's store-refresh wiring: without it, the modal's own AppState is
    // isolated from the TaskStore, so mutating Start/Plan (or any field) via RightPanel's
    // Planning disclosure updates the file/store but leaves this modal showing the stale
    // task object — RightPanel's Start/Plan chips (task.start / task.scheduled) then never
    // appear until the modal is closed and reopened.
    if (this.queries && taskRefOf(task)) {
      this.storeUnsub = this.queries.subscribe((event) => this.onIndexEvent(event));
    }

    const backdrop = this.ownerDoc.body.createDiv({ cls: 'tc-modal-backdrop' });
    this.backdropEl = backdrop;
    // Marks the document so hover-preview popovers can stack above the modal (see styles.css).
    this.ownerDoc.body.addClass('tc-modal-open');

    const modal = backdrop.createDiv({ cls: 'tc-modal' });
    this.modalEl = modal;

    const panelEl = modal.createDiv({ cls: 'tc-right tc-modal-body' });
    this.innerPanel = new RightPanel(
      this.innerState,
      this.app,
      this.settings,
      (root) => this.acknowledgeOwnWrite(root),
      this.tasks,
    );
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
    this.selectionUnsub?.();
    this.selectionUnsub = null;
    this.ownerDoc?.body.removeClass('tc-modal-open');
    this.ownerDoc = null;
    this.innerPanel?.destroy();
    this.innerPanel = null;
    this.innerState = null;
    this.ownedWriteRef = undefined;
    this.modalEl = null;
    this.backdropEl?.remove();
    this.backdropEl = null;
  }

  private onIndexEvent(event: TaskIndexEvent): void {
    const stack = this.innerState?.get('taskStack');
    const root = stack?.[0];
    if (!stack || !root) return;
    const ref = taskRefOf(root);
    if (!ref || !this.queries || !this.affects(event, ref.filePath)) return;
    this.applyResolution(this.queries.resolve(ref), stack);
  }

  private affects(event: TaskIndexEvent, path: string): boolean {
    if (event.type === 'initialized') return true;
    if (event.type === 'changed') return event.files.includes(path);
    if (event.type === 'renamed') return event.oldPath === path || event.newPath === path;
    return event.path === path;
  }

  private applyResolution(resolution: TaskResolution, stack: Array<Task | SubTask>): void {
    this.clearResolutionMessage();
    const rootRef = stack[0] ? taskRefOf(stack[0]) : undefined;
    const ownWrite = Boolean(
      rootRef && this.ownedWriteRef && this.sameRef(rootRef, this.ownedWriteRef),
    );
    this.ownedWriteRef = undefined;
    if (resolution.type === 'exact') {
      this.innerState?.set(
        'taskStack',
        rebuildLegacyTaskStack(legacyTaskView(resolution.task), stack),
      );
      return;
    }
    if (ownWrite && resolution.type === 'conflict') {
      this.innerState?.set(
        'taskStack',
        rebuildLegacyTaskStack(legacyTaskView(resolution.current), stack),
      );
      return;
    }
    if (resolution.type === 'not-found') {
      this.close();
      return;
    }
    if (resolution.type === 'conflict') {
      const banner = this.createResolutionMessage(
        'tc-task-selection-stale',
        'This task changed outside the calendar.',
      );
      this.addAction(banner, 'Reload', 'tc-task-selection-reload', () => {
        const stale = this.innerState?.get('taskStack') ?? [];
        this.innerState?.set(
          'taskStack',
          rebuildLegacyTaskStack(legacyTaskView(resolution.current), stale),
        );
        this.clearResolutionMessage();
      });
      this.addAction(banner, 'Close', 'tc-task-selection-close', () => this.close());
      return;
    }
    const banner = this.createResolutionMessage(
      'tc-task-selection-ambiguous',
      'Choose the task to keep open:',
    );
    for (const candidate of resolution.candidates) {
      const label = `${candidate.root.title} — ${candidate.root.source.filePath}:${candidate.root.source.line + 1}`;
      this.addAction(banner, label, 'tc-task-selection-candidate', () => {
        const stale = this.innerState?.get('taskStack') ?? [];
        this.innerState?.set(
          'taskStack',
          rebuildLegacyTaskStack(legacyTaskView(candidate.root), stale),
        );
        this.clearResolutionMessage();
      });
    }
  }

  private acknowledgeOwnWrite(taskOrRef?: Task | SubTask | TaskRef): void {
    const selected = this.innerState?.get('taskStack')[0];
    const selectedRef = selected ? taskRefOf(selected) : undefined;
    let suppliedRef: TaskRef | undefined;
    if (taskOrRef) suppliedRef = 'revision' in taskOrRef ? taskOrRef : taskRefOf(taskOrRef);
    if (suppliedRef && (!selectedRef || !this.sameRef(suppliedRef, selectedRef))) return;
    const acknowledged = suppliedRef ?? selectedRef;
    this.ownedWriteRef = acknowledged ? { ...acknowledged } : undefined;
  }

  private sameRef(left: TaskRef, right: TaskRef): boolean {
    return (
      left.filePath === right.filePath &&
      left.line === right.line &&
      left.revision === right.revision
    );
  }

  private createResolutionMessage(className: string, text: string): HTMLElement {
    const banner = activeDocument.createElement('div');
    banner.className = `tc-task-selection-message ${className}`;
    banner.createSpan({ text });
    this.modalEl?.prepend(banner);
    return banner;
  }

  private addAction(
    parent: HTMLElement,
    label: string,
    className: string,
    action: () => void,
  ): void {
    const button = parent.createEl('button', { cls: className, text: label });
    button.addEventListener('click', action);
  }

  private clearResolutionMessage(): void {
    this.modalEl?.querySelector('.tc-task-selection-message')?.remove();
  }
}
