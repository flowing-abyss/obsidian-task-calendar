import { setIcon } from 'obsidian';
import type { AppState, ViewMode } from '../app/AppState';

interface RailItem {
  mode: ViewMode;
  icon: string;
  label: string;
}

const ITEMS: RailItem[] = [
  { mode: 'tasks', icon: 'list-checks', label: 'Tasks' },
  { mode: 'calendar', icon: 'calendar-days', label: 'Calendar' },
  { mode: 'search', icon: 'search', label: 'Search' },
];

export class RailPanel {
  private el!: HTMLElement;
  private offMode?: () => void;

  constructor(
    private state: AppState,
    private app: { setting?: { open?: () => void; openTabById?: (id: string) => void } },
  ) {}

  mount(container: HTMLElement): void {
    this.el = container;
    this.offMode = this.state.on('mode', () => this.render());
    this.render();
  }

  destroy(): void {
    this.offMode?.();
    this.el?.empty();
  }

  private render(): void {
    this.el.empty();
    const mode = this.state.get('mode');

    const topGroup = this.el.createDiv({ cls: 'tc-rail-top' });
    for (const item of ITEMS) {
      const btn = topGroup.createEl('button', {
        cls: `tc-rail-btn${mode === item.mode ? ' is-active' : ''}`,
        attr: { 'aria-label': item.label, title: item.label },
      });
      setIcon(btn, item.icon);
      btn.addEventListener('click', () => {
        this.state.set('mode', item.mode);
      });
    }

    // Settings at bottom
    const bottomGroup = this.el.createDiv({ cls: 'tc-rail-bottom' });
    const settingsBtn = bottomGroup.createEl('button', {
      cls: 'tc-rail-btn',
      attr: { 'aria-label': 'Settings', title: 'Settings' },
    });
    setIcon(settingsBtn, 'settings');
    settingsBtn.addEventListener('click', () => {
      this.app.setting?.open?.();
      this.app.setting?.openTabById?.('task-calendar');
      settingsBtn.addClass('is-active');
      const mo = new MutationObserver(() => {
        if (!activeDocument.querySelector('.modal-container .modal')) {
          settingsBtn.removeClass('is-active');
          mo.disconnect();
        }
      });
      mo.observe(activeDocument.body, { childList: true, subtree: true });
    });
  }
}
