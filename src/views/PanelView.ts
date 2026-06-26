import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { AppState } from '../app/AppState';
import { CenterPanel } from '../panels/CenterPanel';
import { LeftPanel } from '../panels/LeftPanel';
import { RailPanel } from '../panels/RailPanel';
import { RightPanel } from '../panels/RightPanel';
import type { CalendarSettings } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';
import type { TagManager } from '../tags/TagManager';

export const PANEL_VIEW_TYPE = 'task-calendar-panel';

export class PanelView extends ItemView {
  private state!: AppState;
  private rail!: RailPanel;
  private left!: LeftPanel;
  private center!: CenterPanel;
  private right!: RightPanel;
  private storeUnsub?: () => void;
  private modeUnsub?: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private settings: CalendarSettings,
    private tagManager: TagManager,
    private onSaveSettings: () => Promise<void> = async () => {},
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

    const layout = this.contentEl.createDiv({ cls: 'tc-layout tc-layout--tasks' });
    const railEl = layout.createDiv({ cls: 'tc-rail' });
    const leftEl = layout.createDiv({ cls: 'tc-left' });
    const centerEl = layout.createDiv({ cls: 'tc-center' });
    const rightEl = layout.createDiv({ cls: 'tc-right' });

    this.rail = new RailPanel(this.state, this.app as never);
    this.left = new LeftPanel(this.state, this.store, this.settings, this.tagManager, this.app);
    this.center = new CenterPanel(
      this.state,
      this.store,
      this.app,
      this.settings,
      this.tagManager,
      this.onSaveSettings,
    );
    this.right = new RightPanel(this.state, this.app, this.settings);

    this.rail.mount(railEl);
    this.left.mount(leftEl);
    this.center.mount(centerEl);
    this.right.mount(rightEl);

    // Update layout class whenever mode changes
    this.modeUnsub = this.state.on('mode', (mode) => {
      layout.className = `tc-layout tc-layout--${mode}`;
    });

    this.storeUnsub = this.store.onUpdate(({ changedFile }) => {
      this.left.refresh();
      this.center.refresh();
      // Refresh taskStack with fresh objects from the store so the right panel re-renders
      const stack = this.state.get('taskStack');
      if (stack.length === 0) return;
      const root = stack[0];
      if (!root || !changedFile || root.filePath !== changedFile) return;
      const freshTasks = this.store.getTasks();
      const freshRoot = freshTasks.find(
        (t) => t.filePath === root.filePath && t.line === root.line,
      );
      if (!freshRoot) {
        // Task was deleted
        this.state.set('taskStack', []);
        return;
      }
      if (stack.length === 1) {
        this.state.set('taskStack', [freshRoot]);
        return;
      }
      // Rebuild deeper stack levels (subtask navigation)
      const freshStack: Array<import('../parser/types').Task | import('../parser/types').SubTask> =
        [freshRoot];
      for (let i = 1; i < stack.length; i++) {
        const prev = freshStack[i - 1];
        const stale = stack[i];
        if (!prev || !stale) break;
        const freshSub = prev.subtasks?.find((s) => s.line === stale.line);
        if (!freshSub) break;
        freshStack.push(freshSub);
      }
      this.state.set('taskStack', freshStack);
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async onClose(): Promise<void> {
    this.modeUnsub?.();
    this.storeUnsub?.();
    this.rail?.destroy();
    this.left?.destroy();
    this.center?.destroy();
    this.right?.destroy();
    this.contentEl.empty();
  }
}
