import { App, Plugin, PluginSettingTab, Setting, setIcon } from 'obsidian';
import { DailyNoteResolver } from '../resolvers/DailyNoteResolver';
import type { TagManager } from '../tags/TagManager';
import type { CalendarSettings } from './types';

interface TaskCalendarPlugin extends Plugin {
  settings: CalendarSettings;
  tagManager: TagManager;
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

    const openIndices = new Set<number>();
    containerEl.querySelectorAll('.tc-settings-section').forEach((el, i) => {
      if (el.classList.contains('is-open')) openIndices.add(i);
    });

    containerEl.empty();

    this.addSection(containerEl, 'General', 'sliders-horizontal', (body) =>
      this.renderGeneralSettings(body),
    );
    this.addSection(containerEl, 'Desktop', 'monitor', (body) =>
      this.renderViewConfigSettings(body, 'desktop'),
    );
    this.addSection(containerEl, 'Mobile', 'smartphone', (body) =>
      this.renderViewConfigSettings(body, 'mobile'),
    );
    this.addSection(containerEl, 'Inbox', 'inbox', (body) => this.renderInboxSettings(body));
    this.addSection(containerEl, 'Tag groups', 'tags', (body) => this.renderTagGroupSettings(body));

    containerEl.querySelectorAll('.tc-settings-section').forEach((el, i) => {
      if (openIndices.has(i)) el.classList.add('is-open');
    });
  }

  private addSection(
    containerEl: HTMLElement,
    title: string,
    icon: string,
    renderFn: (bodyEl: HTMLElement) => void,
  ): void {
    const section = containerEl.createDiv({ cls: 'tc-settings-section' });

    const header = section.createDiv({ cls: 'tc-settings-section-header' });

    const iconEl = header.createDiv({ cls: 'tc-settings-section-icon' });
    setIcon(iconEl, icon);

    header.createSpan({ cls: 'tc-settings-section-label', text: title });

    const chevronEl = header.createDiv({ cls: 'tc-settings-section-chevron' });
    setIcon(chevronEl, 'chevron-right');

    const body = section.createDiv({ cls: 'tc-settings-section-body' });
    renderFn(body);

    header.addEventListener('click', () => {
      section.classList.toggle('is-open');
    });
  }

  private renderGeneralSettings(containerEl: HTMLElement): void {
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
      .setName('Source note display')
      .setDesc('Show which note a task comes from, before the tag chip in list view.')
      .addDropdown((d) =>
        d
          .addOptions({
            never: 'Never',
            'non-default': 'Non-default notes only',
            always: 'Always',
          })
          .setValue(this.plugin.settings.sourceNoteDisplay)
          .onChange(async (v) => {
            this.plugin.settings.sourceNoteDisplay = v as CalendarSettings['sourceNoteDisplay'];
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

    if (this.plugin.settings.addToToday) {
      const resolver = new DailyNoteResolver(this.app, this.plugin.settings);
      const providers = resolver.getAvailableProviders();
      const providerOptions: Record<string, string> = {};
      for (const p of providers) {
        providerOptions[p.id] = p.label;
      }
      // Always include all providers so user can force a choice even if not detected
      if (!providerOptions['periodic-notes']) providerOptions['periodic-notes'] = 'Periodic Notes';
      if (!providerOptions['core']) providerOptions['core'] = 'Core Daily Notes';
      if (!providerOptions['obsidian-journal'])
        providerOptions['obsidian-journal'] = 'Obsidian Journal';
      if (!providerOptions['manual']) providerOptions['manual'] = 'Manual';

      const adapter = resolver.getActiveAdapter();
      const ps = adapter.getSettings(this.app, this.plugin.settings);
      const providerDesc = createFragment();
      providerDesc.appendText('Which plugin manages your daily notes.');
      try {
        const todayPath =
          (ps.folder ? `${ps.folder}/` : '') + window.moment().format(ps.format) + '.md';
        providerDesc.createEl('br');
        providerDesc.appendText('Today → ');
        providerDesc.createEl('code', { text: todayPath });
        if (ps.template) {
          providerDesc.appendText('  template: ');
          providerDesc.createEl('code', { text: ps.template });
        }
      } catch {
        // moment not available in test environment
      }

      new Setting(containerEl)
        .setName('Daily note provider')
        .setDesc(providerDesc)
        .addDropdown((d) =>
          d
            .addOptions(providerOptions)
            .setValue(this.plugin.settings.dailyNoteProvider)
            .onChange(async (v) => {
              this.plugin.settings.dailyNoteProvider =
                v as typeof this.plugin.settings.dailyNoteProvider;
              await this.plugin.saveSettings();
              // eslint-disable-next-line @typescript-eslint/no-deprecated
              this.display();
            }),
        );

      if (this.plugin.settings.dailyNoteProvider === 'manual') {
        new Setting(containerEl)
          .setName('Note path pattern')
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setDesc('Folder + date format, e.g. Daily/YYYY-MM-DD or just YYYY-MM-DD.')
          .addText((t) =>
            t
              // eslint-disable-next-line obsidianmd/ui/sentence-case
              .setPlaceholder('YYYY-MM-DD')
              .setValue(this.plugin.settings.manualDailyNotePath)
              .onChange(async (v) => {
                this.plugin.settings.manualDailyNotePath = v;
                await this.plugin.saveSettings();
                // eslint-disable-next-line @typescript-eslint/no-deprecated
                this.display();
              }),
          );
      }

      new Setting(containerEl)
        .setName('Insert position')
        .setDesc('Where in the daily note to add new tasks.')
        .addDropdown((d) =>
          d
            .addOptions({ append: 'End of file', section: 'Under section heading' })
            .setValue(this.plugin.settings.taskInsertionMode)
            .onChange(async (v) => {
              this.plugin.settings.taskInsertionMode =
                v as typeof this.plugin.settings.taskInsertionMode;
              await this.plugin.saveSettings();
              // eslint-disable-next-line @typescript-eslint/no-deprecated
              this.display();
            }),
        );

      if (this.plugin.settings.taskInsertionMode === 'section') {
        new Setting(containerEl)
          .setName('Section heading')
          .setDesc('Tasks are inserted under this heading. Created if absent.')
          .addText((t) =>
            t
              .setPlaceholder('## Tasks')
              .setValue(this.plugin.settings.taskInsertionSection)
              .onChange(async (v) => {
                this.plugin.settings.taskInsertionSection = v;
                await this.plugin.saveSettings();
              }),
          );
      }
    } else {
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
  }

  private renderInboxSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Inbox source')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('What appears in your Inbox list.')
      .addDropdown((d) =>
        d
          .addOptions({
            tag: 'Tasks with inbox tag',
            untagged: 'Untagged tasks',
            both: 'Both',
          })
          .setValue(this.plugin.settings.inbox.mode)
          .onChange(async (v) => {
            this.plugin.settings.inbox.mode = v as 'tag' | 'untagged' | 'both';
            await this.plugin.saveSettings();
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            this.display();
          }),
      );

    if (this.plugin.settings.inbox.mode !== 'untagged') {
      new Setting(containerEl)
        .setName('Inbox tag')

        .setDesc('Tasks with this tag appear in inbox.')
        .addText((t) =>
          t
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setPlaceholder('#task/inbox')
            .setValue(this.plugin.settings.inbox.tag)
            .onChange(async (v) => {
              this.plugin.settings.inbox.tag = v.trim();
              await this.plugin.saveSettings();
            }),
        );
    }

    new Setting(containerEl)
      .setName('Show untagged tasks in inbox')
      .setDesc('Tasks with no tags also appear in inbox.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.inbox.showUntagged).onChange(async (v) => {
          this.plugin.settings.inbox.showUntagged = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Remove inbox tag when assigning another tag')
      .setDesc('When you drag a task to a tag, the inbox tag is removed automatically.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.inbox.removeTagOnAssign).onChange(async (v) => {
          this.plugin.settings.inbox.removeTagOnAssign = v;
          await this.plugin.saveSettings();
        }),
      );
  }

  private renderTagGroupSettings(containerEl: HTMLElement): void {
    const groups = this.plugin.settings.tagGroups;
    for (let idx = 0; idx < groups.length; idx++) {
      this.renderTagGroupCard(containerEl, idx);
    }

    const archived = this.plugin.settings.archivedTags;
    if (archived.length > 0) {
      new Setting(containerEl).setName('Archived tags').setHeading();
      for (const tag of archived) {
        new Setting(containerEl).setName(tag).addButton((b) =>
          b.setButtonText('Unarchive').onClick(async () => {
            await this.plugin.tagManager.unarchiveTag(tag);
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            this.display();
          }),
        );
      }
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

    new Setting(card).setName('Color').addColorPicker((cp) =>
      cp.setValue(group.color ?? '#888888').onChange(async (v) => {
        group.color = v;
        await this.plugin.saveSettings();
      }),
    );

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

    if (this.plugin.settings.dailyNoteProvider === 'manual' || !this.plugin.settings.addToToday) {
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
    }

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
