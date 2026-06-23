import { setIcon } from 'obsidian';
import type { AppState, ListSelection } from '../app/AppState';
import type { Task } from '../parser/types';
import type { CalendarSettings, TagGroup } from '../settings/types';
import type { TaskStore } from '../store/TaskStore';

export class LeftPanel {
  private el!: HTMLElement;
  private offs: Array<() => void> = [];
  private expandedGroups = new Set<string>();
  private explicitlyCollapsed = new Set<string>();

  constructor(
    private state: AppState,
    private store: TaskStore,
    private settings: CalendarSettings,
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
    if (mode === 'search') return; // hidden in search mode

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

    const tags = this.resolveGroupTags(group, allTasks);

    // Auto-expand when a child tag of this group is currently selected
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

    header.createEl('span', {
      cls: `tc-left-icon tc-group-arrow${isExpanded ? ' is-open' : ''}`,
      text: isExpanded ? '▼' : '▶',
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

    header.addEventListener('click', () => {
      if (isExpanded) {
        // Collapse — keep selection but close the tree
        this.expandedGroups.delete(group.id);
        this.explicitlyCollapsed.add(group.id);
      } else {
        // Expand + select the group
        this.explicitlyCollapsed.delete(group.id); // remove explicit-collapse when user re-expands
        this.expandedGroups.add(group.id);
        this.state.set('selectedList', { type: 'group', groupId: group.id });
        this.state.set('mode', 'tasks');
      }
      this.render();
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
      }
    }
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
    const { inboxMode, inboxTag } = this.settings;
    if (inboxMode === 'tag') {
      return tasks.filter((t) => t.status === 'open' && t.rawText.includes(inboxTag)).length;
    }
    return tasks.filter((t) => {
      if (t.status !== 'open') return false;
      return !/#[\w/-]+/u.test(t.rawText);
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
