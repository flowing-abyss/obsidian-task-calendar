import { ItemView, Platform, type WorkspaceLeaf } from 'obsidian'
import { CalendarRenderer } from '../ui/CalendarRenderer'
import type { CalendarSettings, ResolvedConfig } from '../settings/types'
import type { TaskStore } from '../store/TaskStore'
import { DEFAULT_VIEW_CONFIG } from '../settings/defaults'

export const PANEL_VIEW_TYPE = 'task-calendar-panel'

export class PanelView extends ItemView {
  private renderer: CalendarRenderer | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private store: TaskStore,
    private settings: CalendarSettings,
  ) {
    super(leaf)
  }

  getViewType(): string { return PANEL_VIEW_TYPE }
  getDisplayText(): string { return 'Task Calendar' }
  getIcon(): string { return 'calendar-days' }

  async onOpen(): Promise<void> {
    const platformConfig = Platform.isMobile ? this.settings.mobile : this.settings.desktop
    const config: ResolvedConfig = { ...DEFAULT_VIEW_CONFIG, ...platformConfig, isMobile: Platform.isMobile }
    const rootEl = this.contentEl.createDiv({
      cls: `tasksCalendar ${config.style}`,
      attr: { style: 'position:relative;-webkit-user-select:none!important' },
    })
    this.renderer = new CalendarRenderer(rootEl, this.store, config, this.app)
    this.renderer.mount()
  }

  async onClose(): Promise<void> {
    this.renderer?.destroy()
    this.renderer = null
    this.contentEl.empty()
  }
}
