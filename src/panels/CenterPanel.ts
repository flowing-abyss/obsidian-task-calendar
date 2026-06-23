import type { App } from 'obsidian';
import type { AppState } from '../app/AppState';
import type { TaskStore } from '../store/TaskStore';

export class CenterPanel {
  private el!: HTMLElement;
  constructor(
    private state: AppState,
    private store: TaskStore,
    private app: App,
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
    this.el.createEl('span', { text: 'Center' });
  }
}
