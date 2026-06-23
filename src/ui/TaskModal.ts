import type { App } from 'obsidian';
import { AppState } from '../app/AppState';
import type { Task } from '../parser/types';
import { RightPanel } from '../panels/RightPanel';

export class TaskModal {
  private backdropEl: HTMLElement | null = null;
  private innerState: AppState | null = null;
  private innerPanel: RightPanel | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private app: App) {}

  open(task: Task): void {
    this.close();

    // Temporary isolated state just for this modal
    this.innerState = new AppState();
    this.innerState.set('taskStack', [task]);

    const backdrop = activeDocument.body.createDiv({ cls: 'tc-modal-backdrop' });
    this.backdropEl = backdrop;

    const modal = backdrop.createDiv({ cls: 'tc-modal' });

    // Close button — sits in the top-right corner via CSS
    const closeBtn = modal.createEl('button', {
      cls: 'tc-modal-close-btn tc-right-action-btn',
      attr: { 'aria-label': 'Close', title: 'Close' },
      text: '✕',
    });
    closeBtn.addEventListener('click', () => this.close());

    // Inner panel container — uses tc-right class so all RightPanel styles apply
    const panelEl = modal.createDiv({ cls: 'tc-right tc-modal-body' });
    this.innerPanel = new RightPanel(this.innerState, this.app);
    this.innerPanel.mount(panelEl);

    // Close on backdrop click (not on the modal itself)
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close();
    });

    // Close on Escape
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    activeDocument.addEventListener('keydown', this.keyHandler);
  }

  close(): void {
    if (this.keyHandler) {
      activeDocument.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.innerPanel?.destroy();
    this.innerPanel = null;
    this.innerState = null;
    this.backdropEl?.remove();
    this.backdropEl = null;
  }
}
