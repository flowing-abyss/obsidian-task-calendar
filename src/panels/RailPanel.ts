import type { AppState } from '../app/AppState';

export class RailPanel {
  private el!: HTMLElement;
  constructor(private state: AppState) {}
  mount(container: HTMLElement): void {
    this.el = container;
    this.el.addClass('tc-rail');
    this.render();
  }
  destroy(): void {
    this.el?.empty();
  }
  private render(): void {
    this.el.empty();
    this.el.createEl('span', { text: 'Rail' });
  }
}
