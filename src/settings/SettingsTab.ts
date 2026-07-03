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
  /** Ids of cards (statuses / tag groups) currently expanded — persists across re-renders. */
  private expandedCards = new Set<string>();

  constructor(
    app: App,
    private plugin: TaskCalendarPlugin,
  ) {
    super(app, plugin);
  }

  /**
   * Renders a list of collapsible, drag-to-reorder cards. Collapsed by default
   * (title only) so the whole set can be scanned at a glance; click to expand
   * and edit. Shared by statuses and tag groups for a consistent UI.
   */
  private renderCardList<T>(
    containerEl: HTMLElement,
    items: T[],
    opts: {
      id: (item: T) => string;
      title: (item: T) => string;
      accent?: (item: T) => string | undefined;
      badge?: (item: T) => string | undefined;
      body: (bodyEl: HTMLElement, idx: number) => void;
      onReorder: (from: number, to: number) => void;
    },
  ): void {
    items.forEach((item, idx) => {
      const id = opts.id(item);
      const expanded = this.expandedCards.has(id);
      const card = containerEl.createDiv({ cls: `tc-settings-card${expanded ? ' is-open' : ''}` });

      // The card is a drop target; only its header is the drag SOURCE, so text
      // selection inside expanded body inputs isn't hijacked by dragging.
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        card.addClass('tc-drag-over');
      });
      card.addEventListener('dragleave', () => card.removeClass('tc-drag-over'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.removeClass('tc-drag-over');
        const from = Number(e.dataTransfer?.getData('text/plain'));
        if (!Number.isNaN(from) && from !== idx) opts.onReorder(from, idx);
      });

      const header = card.createDiv({
        cls: 'tc-settings-card-header',
        attr: { draggable: 'true' },
      });
      header.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', String(idx));
        card.addClass('tc-dragging');
      });
      header.addEventListener('dragend', () => card.removeClass('tc-dragging'));
      const grip = header.createSpan({ cls: 'tc-settings-card-grip' });
      setIcon(grip, 'grip-vertical');
      const accent = opts.accent?.(item);
      if (accent) {
        const dot = header.createSpan({ cls: 'tc-status-dot' });
        dot.style.background = accent;
      }
      header.createSpan({ cls: 'tc-settings-card-title', text: opts.title(item) });
      const badge = opts.badge?.(item);
      if (badge) header.createSpan({ cls: 'tc-settings-card-badge', text: badge });
      const chevron = header.createSpan({ cls: 'tc-settings-card-chevron' });
      setIcon(chevron, expanded ? 'chevron-down' : 'chevron-right');
      header.addEventListener('click', () => {
        if (expanded) this.expandedCards.delete(id);
        else this.expandedCards.add(id);
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.display();
      });

      if (expanded) {
        const bodyEl = card.createDiv({ cls: 'tc-settings-card-body' });
        opts.body(bodyEl, idx);
      }
    });
  }

  private moveItem<T>(arr: T[], from: number, to: number): void {
    const item = arr[from];
    if (item === undefined) return;
    arr.splice(from, 1);
    arr.splice(to, 0, item);
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
    this.addSection(containerEl, 'Projects', 'folder-kanban', (body) =>
      this.renderProjectsSettings(body),
    );

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
    this.renderCardList(containerEl, groups, {
      id: (g) => g.id,
      title: (g) => g.name,
      accent: (g) => g.color,
      badge: (g) => (g.mode === 'prefix' ? 'prefix' : 'manual'),
      body: (bodyEl, idx) => this.renderTagGroupCard(bodyEl, idx),
      onReorder: (from, to) => {
        this.moveItem(groups, from, to);
        void this.plugin.saveSettings();
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.display();
      },
    });

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
          const id = `group-${Date.now()}`;
          this.plugin.settings.tagGroups.push({
            id,
            name: 'New group',
            mode: 'prefix',
            prefix: '',
          });
          this.expandedCards.add(id);
          await this.plugin.saveSettings();
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
    );
  }

  private renderTagGroupCard(card: HTMLElement, idx: number): void {
    const groups = this.plugin.settings.tagGroups;
    const group = groups[idx];
    if (!group) return;

    new Setting(card).setName('Group name').addText((t) =>
      t.setValue(group.name).onChange(async (v) => {
        group.name = v;
        await this.plugin.saveSettings();
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

    new Setting(card).addButton((b) =>
      b
        .setButtonText('Delete group')
        .setClass('mod-warning')
        .onClick(async () => {
          const removed = groups.splice(idx, 1)[0];
          if (removed) this.expandedCards.delete(removed.id);
          await this.plugin.saveSettings();
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
    );
  }

  private renderProjectsSettings(containerEl: HTMLElement): void {
    const projects = this.plugin.settings.projects;

    new Setting(containerEl)
      .setName('Membership query')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('What counts as a project. Syntax: folder/, #tag, key=value, AND / OR / NOT / ( ).')
      .addText((t) =>
        t

          .setPlaceholder('Projects/')
          .setValue(projects.membershipQuery)
          .onChange(async (v) => {
            projects.membershipQuery = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Create folder')
      .setDesc('Where new project notes are created.')
      .addText((t) =>
        t

          .setPlaceholder('Projects')
          .setValue(projects.createFolder)
          .onChange(async (v) => {
            projects.createFolder = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Template path')
      .setDesc('Optional template for new projects. Templater is used when installed.')
      .addText((t) =>
        t
          .setPlaceholder('Templates/Project.md')
          .setValue(projects.templatePath)
          .onChange(async (v) => {
            projects.templatePath = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName('Statuses').setHeading();
    this.renderCardList(containerEl, projects.statuses, {
      id: (s) => s.id,
      title: (s) => s.label,
      accent: (s) => s.color,
      badge: (s) => (s.match.kind === 'tag' ? 'tag' : 'property'),
      body: (bodyEl, idx) => this.renderStatusCard(bodyEl, idx),
      onReorder: (from, to) => {
        this.moveItem(projects.statuses, from, to);
        void this.plugin.saveSettings();
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.display();
      },
    });

    new Setting(containerEl).addButton((b) =>
      b
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setButtonText('+ Add status')
        .setCta()
        .onClick(async () => {
          // Collision-proof id: smallest status-N not already taken.
          let n = projects.statuses.length + 1;
          while (projects.statuses.some((s) => s.id === `status-${n}`)) n++;
          const id = `status-${n}`;
          projects.statuses.push({
            id,
            label: 'New status',
            color: '#888888',
            onLeftPanel: false,
            match: { kind: 'property', property: 'status', value: '' },
          });
          this.expandedCards.add(id); // open the new card for editing
          await this.plugin.saveSettings();
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
    );

    // A single place to pick the default status — not a per-status toggle.
    if (projects.statuses.length > 0) {
      new Setting(containerEl)
        .setName('Default status')
        .setDesc('Applied to newly created projects.')
        .addDropdown((d) => {
          for (const s of projects.statuses) d.addOption(s.id, s.label);
          d.setValue(projects.defaultStatusId || projects.statuses[0]!.id).onChange(async (v) => {
            projects.defaultStatusId = v;
            await this.plugin.saveSettings();
          });
        });
    }
  }

  private renderStatusCard(card: HTMLElement, idx: number): void {
    const projects = this.plugin.settings.projects;
    const statuses = projects.statuses;
    const status = statuses[idx];
    if (!status) return;

    new Setting(card).setName('Label').addText((t) =>
      t.setValue(status.label).onChange(async (v) => {
        status.label = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(card).setName('Defined by').addDropdown((d) =>
      d
        .addOptions({ property: 'Frontmatter property', tag: 'Tag' })
        .setValue(status.match.kind)
        .onChange(async (v) => {
          status.match =
            v === 'tag'
              ? { kind: 'tag', tag: '' }
              : { kind: 'property', property: 'status', value: '' };
          await this.plugin.saveSettings();
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
    );

    if (status.match.kind === 'property') {
      const match = status.match;
      new Setting(card).setName('Property').addText((t) =>
        t
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setPlaceholder('status')
          .setValue(match.property)
          .onChange(async (v) => {
            match.property = v.trim();
            await this.plugin.saveSettings();
          }),
      );
      new Setting(card).setName('Value').addText((t) =>
        t
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setPlaceholder('active')
          .setValue(match.value)
          .onChange(async (v) => {
            match.value = v.trim();
            await this.plugin.saveSettings();
          }),
      );
    } else {
      const match = status.match;
      new Setting(card).setName('Tag').addText((t) =>
        t
          // eslint-disable-next-line obsidianmd/ui/sentence-case
          .setPlaceholder('active')
          .setValue(match.tag)
          .onChange(async (v) => {
            match.tag = v.trim().replace(/^#/, '');
            await this.plugin.saveSettings();
          }),
      );
    }

    new Setting(card).setName('Color').addColorPicker((cp) =>
      cp.setValue(status.color ?? '#888888').onChange(async (v) => {
        status.color = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(card).setName('Show on left panel').addToggle((tg) =>
      tg.setValue(status.onLeftPanel).onChange(async (v) => {
        status.onLeftPanel = v;
        await this.plugin.saveSettings();
      }),
    );

    new Setting(card).addButton((b) =>
      b
        .setButtonText('Delete status')
        .setClass('mod-warning')
        .setDisabled(statuses.length <= 1)
        .onClick(async () => {
          const removed = statuses.splice(idx, 1)[0];
          if (removed) {
            this.expandedCards.delete(removed.id);
            if (projects.defaultStatusId === removed.id) {
              projects.defaultStatusId = statuses[0]?.id ?? '';
            }
          }
          await this.plugin.saveSettings();
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          this.display();
        }),
    );
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
