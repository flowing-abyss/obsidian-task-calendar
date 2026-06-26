import { Plugin } from 'obsidian';
import { registerCodeBlock, resolveConfig } from './code-block/registerCodeBlock';
import { DEFAULT_SETTINGS } from './settings/defaults';
import { migrateSettings } from './settings/migration';
import { CalendarSettingsTab } from './settings/SettingsTab';
import type { CalendarSettings, CodeBlockParams } from './settings/types';
import { TaskStore } from './store/TaskStore';
import { TagManager } from './tags/TagManager';
import { CalendarRenderer } from './ui/CalendarRenderer';
import { PANEL_VIEW_TYPE, PanelView } from './views/PanelView';

export default class TaskCalendarPlugin extends Plugin {
  store!: TaskStore;
  settings!: CalendarSettings;
  tagManager!: TagManager;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new TaskStore(this.app, this.settings);
    this.tagManager = new TagManager(this.app, this.settings, () => this.saveSettings());

    this.registerView(
      PANEL_VIEW_TYPE,
      (leaf) => new PanelView(leaf, this.store, this.settings, this.tagManager, () => this.saveSettings()),
    );

    registerCodeBlock(this, this.store, this.settings);

    this.addCommand({
      id: 'open-panel',
      name: 'Open view',
      callback: () => {
        void this.openPanel();
      },
    });

    this.addSettingTab(new CalendarSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      void this.store.initialize();
    });

    // Legacy Dataview shim — remove after users migrate to native `task-calendar` code blocks
    (window as unknown as Record<string, unknown>).renderCalendar = (
      dv: unknown,
      params: CodeBlockParams,
    ) => {
      const container = (dv as { container?: HTMLElement } | null)?.container ?? null;
      if (!container) {
        console.warn('[task-calendar] renderCalendar: no Dataview container found');
        return;
      }
      const renderer = new CalendarRenderer(
        container,
        this.store,
        resolveConfig(this.settings, params),
        this.app,
      );
      renderer.mount();
    };
  }

  onunload(): void {
    this.store.destroy();
    delete (window as unknown as Record<string, unknown>).renderCalendar;
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Record<string, unknown> | null | undefined;
    const data: Record<string, unknown> = raw ?? {};
    migrateSettings(data);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data) as CalendarSettings;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async openPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PANEL_VIEW_TYPE);
    if (existing.length > 0 && existing[0]) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: PANEL_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }
}
