import type { App } from 'obsidian';
import { AppState } from '../app/AppState';
import { RightPanel } from '../panels/RightPanel';
import type { Task } from '../parser/types';

export class TaskModal {
  private backdropEl: HTMLElement | null = null;
  private innerState: AppState | null = null;
  private innerPanel: RightPanel | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private ownerDoc: Document | null = null;

  constructor(private app: App) {}

  open(task: Task): void {
    this.close();
    // Capture the active document at open time so close() removes from the same document
    this.ownerDoc = activeDocument;
    this.innerState = new AppState();
    this.innerState.set('taskStack', [task]);

    const backdrop = this.ownerDoc.body.createDiv({ cls: 'tc-modal-backdrop' });
    this.backdropEl = backdrop;

    const modal = backdrop.createDiv({ cls: 'tc-modal' });

    const panelEl = modal.createDiv({ cls: 'tc-right tc-modal-body' });
    this.innerPanel = new RightPanel(this.innerState, this.app);
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
    this.ownerDoc = null;
    this.innerPanel?.destroy();
    this.innerPanel = null;
    this.innerState = null;
    this.backdropEl?.remove();
    this.backdropEl = null;
  }
}
