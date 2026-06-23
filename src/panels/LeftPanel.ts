import type { AppState } from '../app/AppState';
import type { CalendarSettings } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';

export class LeftPanel {
  private el!: HTMLElement;
  constructor(
    private state: AppState,
    private store: TaskStore,
    private settings: CalendarSettings,
  ) {}
  mount(container: HTMLElement): void {
    this.el = container;
    this.render();
  }
  refresh(): void {
    this.render();
  }
  destroy(): void {
    this.el?.empty();
  }
  private render(): void {
    this.el.empty();
    this.el.createEl('span', { text: 'Left' });
  }
}
