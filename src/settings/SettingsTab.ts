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

    this.renderTagGroupSettings(containerEl);
  }

  private renderTagGroupSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName('Tag groups').setHeading();

    new Setting(containerEl)
      .setName('Inbox source')
      .setDesc('Show tasks with a specific tag, or all tasks with no tags.')
      .addDropdown((d) =>
        d
          .addOptions({ tag: 'Tag', untagged: 'Untagged tasks' })
          .setValue(this.plugin.settings.inboxMode)
          .onChange(async (v) => {
            this.plugin.settings.inboxMode = v as 'tag' | 'untagged';
            await this.plugin.saveSettings();
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            this.display();
          }),
      );

    if (this.plugin.settings.inboxMode === 'tag') {
      new Setting(containerEl)
        .setName('Inbox tag')
        .setDesc('Tasks with this tag appear in inbox.')
        .addText((t) =>
          t
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setPlaceholder('#inbox')
            .setValue(this.plugin.settings.inboxTag)
            .onChange(async (v) => {
              this.plugin.settings.inboxTag = v.trim();
              await this.plugin.saveSettings();
            }),
        );
    }

    // Render existing groups
    const groups = this.plugin.settings.tagGroups;
    for (let idx = 0; idx < groups.length; idx++) {
      this.renderTagGroupCard(containerEl, idx);
    }

    new Setting(containerEl).addButton((b) =>
      b
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setButtonText('+ Add group')
        .setCta()
        .onClick(async () => {
          this.plugin.settings.tagGroups.push({
            id: `group-${Date.now()}`,
            name: 'New group',
            mode: 'prefix',
            prefix: '',
          });
          await this.plugin.saveSettings();
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
    );
  }

  private renderTagGroupCard(containerEl: HTMLElement, idx: number): void {
    const groups = this.plugin.settings.tagGroups;
    const group = groups[idx];
    if (!group) return;

    const card = containerEl.createDiv({ cls: 'tc-settings-group-card' });

    new Setting(card)
      .setName('Group name')
      .addText((t) =>
        t.setValue(group.name).onChange(async (v) => {
          group.name = v;
          await this.plugin.saveSettings();
        }),
      )
      .addButton((b) =>
        b
          .setIcon('trash')
          .setTooltip('Delete group')
          .onClick(async () => {
            groups.splice(idx, 1);
            await this.plugin.saveSettings();
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            this.display();
          }),
      );

    new Setting(card).setName('Mode').addDropdown((d) =>
      d
        .addOptions({ prefix: 'Prefix', manual: 'Manual' })
        .setValue(group.mode)
        .onChange(async (v) => {
          group.mode = v as 'prefix' | 'manual';
          await this.plugin.saveSettings();
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
    );

    // Color picker
    const colorRow = card.createEl('div', { cls: 'tc-setting-row' });
    colorRow.createEl('span', { text: 'Color', cls: 'tc-setting-label' });
    const colorInput = colorRow.createEl('input', {
      attr: { type: 'color', value: group.color ?? '#888888' },
    }) as HTMLInputElement;
    colorInput.addEventListener('change', () => {
      group.color = colorInput.value;
      void this.plugin.saveSettings();
    });

    if (group.mode === 'prefix') {
      new Setting(card)
        .setName('Prefix')
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setDesc('e.g. "work" matches #work and #work/dev')
        .addText((t) =>
          t
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setPlaceholder('work')
            .setValue(group.prefix ?? '')
            .onChange(async (v) => {
              group.prefix = v.trim();
              await this.plugin.saveSettings();
            }),
        );
    } else {
      new Setting(card)
        .setName('Tags')
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setDesc('Comma-separated, e.g. #work, #side-project')
        .addText((t) =>
          t
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setPlaceholder('#work, #side-project')
            .setValue((group.tags ?? []).join(', '))
            .onChange(async (v) => {
              group.tags = v
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              await this.plugin.saveSettings();
            }),
        );
    }
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
