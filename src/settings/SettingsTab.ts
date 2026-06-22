import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { CalendarSettings } from './types';

interface TaskCalendarPlugin extends Plugin {
  settings: CalendarSettings;
  saveSettings(): Promise<void>;
}

export class CalendarSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: TaskCalendarPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Task prefix')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('Prepended when adding a new task (e.g. #task/one-off).')
      .addText((t) =>
        t
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setPlaceholder('#task/one-off')
          .setValue(this.plugin.settings.taskPrefix)
          .onChange(async (v) => {
            this.plugin.settings.taskPrefix = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Add to today's note")
      .setDesc('New tasks are added to the daily note for today.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.addToToday).onChange(async (v) => {
          this.plugin.settings.addToToday = v;
          await this.plugin.saveSettings();
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
      );

    if (!this.plugin.settings.addToToday) {
      new Setting(containerEl)
        .setName('Custom file path')
        .setDesc('Add new tasks to this file instead.')
        .addText((t) =>
          t
            .setPlaceholder('Tasks/inbox.md')
            .setValue(this.plugin.settings.customFilePath)
            .onChange(async (v) => {
              this.plugin.settings.customFilePath = v;
              await this.plugin.saveSettings();
            }),
        );
    }

    new Setting(containerEl).setName('Desktop defaults').setHeading();
    this.renderViewConfigSettings(containerEl, 'desktop');

    new Setting(containerEl).setName('Mobile defaults').setHeading();
    this.renderViewConfigSettings(containerEl, 'mobile');
  }

  private renderViewConfigSettings(container: HTMLElement, platform: 'desktop' | 'mobile'): void {
    const cfg = this.plugin.settings[platform];

    new Setting(container).setName('Default view').addDropdown((d) =>
      d
        .addOptions({ month: 'Month', week: 'Week', list: 'List' })
        .setValue(cfg.defaultView)
        .onChange(async (v) => {
          cfg.defaultView = v as typeof cfg.defaultView;
          await this.plugin.saveSettings();
        }),
    );

    new Setting(container)
      .setName('Default style')
      .setDesc('Visual style (style1–style11).')
      .addDropdown((d) => {
        for (let i = 1; i <= 11; i++) d.addOption(`style${i}`, `Style ${i}`);
        return d.setValue(cfg.style).onChange(async (v) => {
          cfg.style = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(container).setName('First day of week').addDropdown((d) =>
      d
        .addOptions({ '0': 'Sunday', '1': 'Monday', '6': 'Saturday' })
        .setValue(String(cfg.firstDayOfWeek))
        .onChange(async (v) => {
          cfg.firstDayOfWeek = parseInt(v) as typeof cfg.firstDayOfWeek;
          await this.plugin.saveSettings();
        }),
    );

    new Setting(container).setName('Daily note folder').addText((t) =>
      t.setValue(cfg.dailyNoteFolder).onChange(async (v) => {
        cfg.dailyNoteFolder = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(container)
      .setName('Daily note format')
      .setDesc('Moment.js format, e.g. YYYY-MM-DD.')
      .addText((t) =>
        t.setValue(cfg.dailyNoteFormat).onChange(async (v) => {
          cfg.dailyNoteFormat = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(container)
      .setName('Global task filter')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('Tag to strip from task display text, e.g. #task.')
      .addText((t) =>
        t.setValue(cfg.globalTaskFilter).onChange(async (v) => {
          cfg.globalTaskFilter = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(container)
      .setName('Upcoming days')
      .setDesc('Number of days shown in list view.')
      .addText((text) =>
        text.setValue(String(cfg.upcomingDays)).onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n > 0) {
            cfg.upcomingDays = n;
            await this.plugin.saveSettings();
          }
        }),
      );
  }
}
