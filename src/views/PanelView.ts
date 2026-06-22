import { ItemView, Platform, type WorkspaceLeaf } from 'obsidian';
import { DEFAULT_VIEW_CONFIG } from '../settings/defaults';
import type { CalendarSettings, ResolvedConfig } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';
import { CalendarRenderer } from '../ui/CalendarRenderer';

export const PANEL_VIEW_TYPE = 'task-calendar-panel';

export class PanelView extends ItemView {
  private renderer: CalendarRenderer | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private settings: CalendarSettings,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return PANEL_VIEW_TYPE;
  }
  getDisplayText(): string {
    return 'Task calendar';
  }
  getIcon(): string {
    return 'calendar-days';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onOpen(): Promise<void> {
    this.renderer?.destroy();
    const platformConfig = Platform.isMobile ? this.settings.mobile : this.settings.desktop;
    const config: ResolvedConfig = {
      ...DEFAULT_VIEW_CONFIG,
      ...platformConfig,
      isMobile: Platform.isMobile,
    };
    const rootEl = this.contentEl.createDiv({
      cls: `tasksCalendar ${config.style}`,
      attr: { style: 'position:relative;-webkit-user-select:none!important' },
    });
    this.renderer = new CalendarRenderer(rootEl, this.store, config, this.app);
    this.renderer.mount();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onClose(): Promise<void> {
    this.renderer?.destroy();
    this.renderer = null;
    this.contentEl.empty();
  }
}
