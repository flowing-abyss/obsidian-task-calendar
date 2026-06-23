import type { App } from 'obsidian';
import { AppState } from '../app/AppState';
import type { Task } from '../parser/types';
import { RightPanel } from '../panels/RightPanel';

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

    const closeBtn = modal.createEl('button', {
      cls: 'tc-modal-close-btn tc-right-action-btn',
      attr: { 'aria-label': 'Close', title: 'Close' },
      text: '✕',
    });
    closeBtn.addEventListener('click', () => this.close());

    const panelEl = modal.createDiv({ cls: 'tc-right tc-modal-body' });
    this.innerPanel = new RightPanel(this.innerState, this.app);
    this.innerPanel.mount(panelEl);

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
