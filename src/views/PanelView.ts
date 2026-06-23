import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { AppState } from '../app/AppState';
import { CenterPanel } from '../panels/CenterPanel';
import { LeftPanel } from '../panels/LeftPanel';
import { RailPanel } from '../panels/RailPanel';
import { RightPanel } from '../panels/RightPanel';
import type { CalendarSettings } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';

export const PANEL_VIEW_TYPE = 'task-calendar-panel';

export class PanelView extends ItemView {
  private state!: AppState;
  private rail!: RailPanel;
  private left!: LeftPanel;
  private center!: CenterPanel;
  private right!: RightPanel;
  private storeUnsub?: () => void;

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
    this.contentEl.empty();
    this.contentEl.addClass('tc-panel-view');

    this.state = new AppState();

    const layout = this.contentEl.createDiv({ cls: 'tc-layout' });
    const railEl = layout.createDiv({ cls: 'tc-rail' });
    const leftEl = layout.createDiv({ cls: 'tc-left' });
    const centerEl = layout.createDiv({ cls: 'tc-center' });
    const rightEl = layout.createDiv({ cls: 'tc-right' });

    this.rail = new RailPanel(this.state);
    this.left = new LeftPanel(this.state, this.store, this.settings);
    this.center = new CenterPanel(this.state, this.store, this.app);
    this.right = new RightPanel(this.state, this.store, this.app);

    this.rail.mount(railEl);
    this.left.mount(leftEl);
    this.center.mount(centerEl);
    this.right.mount(rightEl);

    this.storeUnsub = this.store.onUpdate(() => {
      this.left.refresh();
      this.center.refresh();
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onClose(): Promise<void> {
    this.storeUnsub?.();
    this.rail?.destroy();
    this.left?.destroy();
    this.center?.destroy();
    this.right?.destroy();
    this.contentEl.empty();
  }
}
