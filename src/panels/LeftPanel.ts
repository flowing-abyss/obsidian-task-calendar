import { Menu, setIcon, type App } from 'obsidian';
import type { AppState, ListSelection } from '../app/AppState';
import type { Task } from '../parser/types';
import type { CalendarSettings, TagGroup } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';
import { RenameTagModal } from '../tags/RenameTagModal';
import type { TagManager } from '../tags/TagManager';

export class LeftPanel {
  private el!: HTMLElement;
  private offs: Array<() => void> = [];
  private expandedGroups = new Set<string>();
  private explicitlyCollapsed = new Set<string>();

  constructor(
    private state: AppState,
    private store: TaskStore,
    private settings: CalendarSettings,
    private tagManager: TagManager,
    private app: App,
  ) {}

  mount(container: HTMLElement): void {
    this.el = container;
    this.offs.push(
      this.state.on('selectedList', () => this.render()),
      this.state.on('mode', () => this.render()),
    );
    this.render();
  }

  refresh(): void {
    this.render();
  }

  destroy(): void {
    this.offs.forEach((f) => f());
    this.el?.empty();
  }

  private render(): void {
    this.el.empty();
    const mode = this.state.get('mode');
    if (mode === 'search') return;

    const allTasks = this.store.getTasks();
    const today = window.moment().format('YYYY-MM-DD');

    this.el.createDiv({ cls: 'tc-left-section' }, (section) => {
      section.createEl('div', { cls: 'tc-left-section-header', text: 'Lists' });
      this.renderSmartList(section, 'inbox', 'Inbox', 'inbox', this.countInbox(allTasks));
      this.renderSmartList(section, 'today', 'Today', 'calendar', this.countToday(allTasks, today));
      this.renderSmartList(
        section,
        'upcoming',
        'Upcoming',
        'arrow-up-right',
        this.countUpcoming(allTasks, today),
      );
    });

    // Pinned section
    if (this.settings.pinnedTags.length > 0) {
      this.el.createDiv({ cls: 'tc-left-divider' });
      this.el.createDiv({ cls: 'tc-left-section tc-left-section--pinned' }, (section) => {
        section.createEl('div', { cls: 'tc-left-section-header', text: 'Pinned' });
        for (const tag of this.settings.pinnedTags) {
          this.renderPinnedTag(section, tag, allTasks);
        }
      });
    }

    // Tag groups (archived tags filtered out)
    const groups = this.settings.tagGroups;
    if (groups.length > 0) {
      this.el.createDiv({ cls: 'tc-left-divider' });
      this.el.createDiv({ cls: 'tc-left-section' }, (section) => {
        section.createEl('div', { cls: 'tc-left-section-header', text: 'Tags' });
        for (const group of groups) {
          this.renderTagGroup(section, group, allTasks);
        }
      });
    }
  }

  private renderPinnedTag(parent: HTMLElement, tag: string, allTasks: Task[]): void {
    const sel = this.state.get('selectedList');
    const isActive = typeof sel === 'object' && sel.type === 'tag' && sel.tag === tag;
    const count = allTasks.filter((t) => t.status === 'open' && t.rawText.includes(tag)).length;

    const row = parent.createDiv({
      cls: `tc-left-item tc-pinned-tag${isActive ? ' is-active' : ''}`,
    });
    row.createDiv({ cls: 'tc-left-item-left' }, (l) => {
      l.createEl('span', { cls: 'tc-left-label', text: tag });
    });
    if (count > 0) row.createEl('span', { cls: 'tc-left-count', text: String(count) });

    row.addEventListener('click', () => {
      this.state.set('selectedList', { type: 'tag', tag });
      this.state.set('mode', 'tasks');
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showPinnedTagMenu(e, tag);
    });

    this.attachDropZone(row, tag);
  }

  private renderSmartList(
    parent: HTMLElement,
    selection: ListSelection,
    label: string,
    icon: string,
    count: number,
  ): void {
    const current = this.state.get('selectedList');
    const isActive = current === selection;
    const row = parent.createDiv({ cls: `tc-left-item${isActive ? ' is-active' : ''}` });

    const left = row.createDiv({ cls: 'tc-left-item-left' });
    const iconEl = left.createEl('span', { cls: 'tc-left-icon' });
    setIcon(iconEl, icon);
    left.createEl('span', { cls: 'tc-left-label', text: label });

    if (count > 0) {
      row.createEl('span', { cls: 'tc-left-count', text: String(count) });
    }

    row.addEventListener('click', () => {
      this.state.set('selectedList', selection);
      this.state.set('mode', 'tasks');
    });
  }

  private renderTagGroup(parent: HTMLElement, group: TagGroup, allTasks: Task[]): void {
    const sel = this.state.get('selectedList');
    const isGroupActive =
      typeof sel === 'object' && sel.type === 'group' && sel.groupId === group.id;

    const tags = this.resolveGroupTags(group, allTasks).filter(
      (t) => !this.settings.archivedTags.includes(t),
    );

    const hasActiveChild = tags.some(
      (t) => typeof sel === 'object' && sel.type === 'tag' && sel.tag === t,
    );
    // Auto-expand when a child is active, UNLESS the user explicitly collapsed this group
    if (hasActiveChild && !this.explicitlyCollapsed.has(group.id)) {
      this.expandedGroups.add(group.id);
    }

    const isExpanded = this.expandedGroups.has(group.id);

    const container = parent.createDiv({ cls: 'tc-tag-group' });
    const header = container.createDiv({
      cls: `tc-tag-group-header${isGroupActive ? ' is-active' : ''}`,
    });

    // Chevron: toggles expand/collapse only, does NOT select the group
    const chevron = header.createEl('span', {
      cls: `tc-left-icon tc-group-arrow${isExpanded ? ' is-open' : ''}`,
      text: isExpanded ? '▼' : '▶',
    });
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isExpanded) {
        this.expandedGroups.delete(group.id);
        this.explicitlyCollapsed.add(group.id);
      } else {
        this.expandedGroups.add(group.id);
        this.explicitlyCollapsed.delete(group.id);
      }
      this.render();
    });

    if (group.color) {
      const dot = header.createEl('span', { cls: 'tc-group-dot' });
      dot.style.background = group.color;
    }
    header.createEl('span', { cls: 'tc-left-label', text: group.name });

    // Count all tasks matching any tag in this group (including root prefix tag)
    const rootTag = group.mode === 'prefix' && group.prefix ? `#${group.prefix}` : null;
    const allGroupTags = rootTag ? [rootTag, ...tags] : tags;
    const groupCount = allTasks.filter(
      (t) => t.status === 'open' && allGroupTags.some((tag) => t.rawText.includes(tag)),
    ).length;
    if (groupCount > 0) {
      header.createEl('span', { cls: 'tc-left-count', text: String(groupCount) });
    }

    // Header click: select the group (expand/collapse is handled by the chevron above)
    header.addEventListener('click', () => {
      this.state.set('selectedList', { type: 'group', groupId: group.id });
      this.state.set('mode', 'tasks');
    });

    if (isExpanded) {
      const children = container.createDiv({ cls: 'tc-tag-group-children' });
      for (const tag of tags) {
        // Strip the group prefix from display label: #work/dev → dev
        const label =
          group.mode === 'prefix' && group.prefix ? tag.replace(`#${group.prefix}/`, '') : tag;

        const tagSel = this.state.get('selectedList');
        const isTagActive =
          typeof tagSel === 'object' && tagSel.type === 'tag' && tagSel.tag === tag;
        const tagCount = allTasks.filter(
          (t) => t.rawText.includes(tag) && t.status === 'open',
        ).length;

        const child = children.createDiv({
          cls: `tc-left-item tc-tag-child${isTagActive ? ' is-active' : ''}`,
        });
        child.createDiv({ cls: 'tc-left-item-left' }, (l) => {
          l.createEl('span', { cls: 'tc-left-label', text: label });
        });
        if (tagCount > 0) child.createEl('span', { cls: 'tc-left-count', text: String(tagCount) });

        child.addEventListener('click', (e) => {
          e.stopPropagation();
          this.state.set('selectedList', { type: 'tag', tag });
          this.state.set('mode', 'tasks');
        });

        child.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.showChildTagMenu(e, tag);
        });

        this.attachDropZone(child, tag);
      }
    }
  }

  private showPinnedTagMenu(e: MouseEvent, tag: string): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle('Unpin')
        .setIcon('pin-off')
        .onClick(this.makeTagOp(() => this.tagManager.unpinTag(tag))),
    );
    menu.addItem((item) =>
      item
        .setTitle('Archive')
        .setIcon('archive')
        .onClick(this.makeTagOp(() => this.tagManager.archiveTag(tag))),
    );
    menu.addItem((item) =>
      item
        .setTitle('Rename')
        .setIcon('pencil')
        .onClick(() => {
          new RenameTagModal(this.app, this.tagManager, tag, () => this.render()).open();
        }),
    );
    menu.showAtMouseEvent(e);
  }

  private showChildTagMenu(e: MouseEvent, tag: string): void {
    const isPinned = this.settings.pinnedTags.includes(tag);
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(isPinned ? 'Unpin' : 'Pin')
        .setIcon(isPinned ? 'pin-off' : 'pin')
        .onClick(
          this.makeTagOp(() =>
            isPinned ? this.tagManager.unpinTag(tag) : this.tagManager.pinTag(tag),
          ),
        ),
    );
    menu.addItem((item) =>
      item
        .setTitle('Archive')
        .setIcon('archive')
        .onClick(this.makeTagOp(() => this.tagManager.archiveTag(tag))),
    );
    menu.addItem((item) =>
      item
        .setTitle('Rename')
        .setIcon('pencil')
        .onClick(() => {
          new RenameTagModal(this.app, this.tagManager, tag, () => this.render()).open();
        }),
    );
    menu.showAtMouseEvent(e);
  }

  private makeTagOp(op: () => Promise<void>): () => void {
    return () => {
      void op().then(() => {
        this.render();
      });
    };
  }

  private attachDropZone(el: HTMLElement, tag: string): void {
    el.addEventListener('dragover', (e) => {
      if (!this.state.get('draggingTask')) return;
      e.preventDefault();
      el.classList.add('tc-drop-target');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('tc-drop-target');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('tc-drop-target');
      const dragging = this.state.get('draggingTask');
      if (!dragging) return;
      void this.tagManager.assignTagFromInbox(dragging, tag);
    });
  }

  private resolveGroupTags(group: TagGroup, allTasks: Task[]): string[] {
    if (group.mode === 'prefix' && group.prefix) {
      const prefix = group.prefix;
      const found = new Set<string>();
      for (const task of allTasks) {
        const matches = task.rawText.match(/#[\w/-]+/gu) ?? [];
        for (const tag of matches) {
          // Only include subtags (e.g. #work/dev), not the root tag (#work) itself
          if (tag.startsWith(`#${prefix}/`)) {
            found.add(tag);
          }
        }
      }
      return Array.from(found).sort((a, b) => a.localeCompare(b));
    }
    return group.tags ?? [];
  }

  private countInbox(tasks: Task[]): number {
    const { inbox } = this.settings;
    const allOpen = tasks.filter((t) => t.status === 'open');
    const withTag =
      inbox.mode !== 'untagged'
        ? allOpen.filter((t) => t.rawText.includes(inbox.tag))
        : [];
    const includeUntagged = inbox.mode !== 'tag' || inbox.showUntagged;
    const untagged = includeUntagged
      ? allOpen.filter((t) => !/#[\w/-]+/u.test(t.rawText))
      : [];
    if (withTag.length === 0) return untagged.length;
    if (untagged.length === 0) return withTag.length;
    const seen = new Set<string>();
    return [...withTag, ...untagged].filter((t) => {
      const key = `${t.filePath}:${t.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).length;
  }

  private countToday(tasks: Task[], today: string): number {
    return tasks.filter((t) => {
      if (t.status !== 'open') return false;
      return t.due === today || t.scheduled === today || t.dailyNoteDate === today;
    }).length;
  }

  private countUpcoming(tasks: Task[], today: string): number {
    return tasks.filter((t) => {
      if (t.status !== 'open') return false;
      const d = t.due ?? t.scheduled ?? t.dailyNoteDate;
      return d !== undefined && d > today;
    }).length;
  }
}
