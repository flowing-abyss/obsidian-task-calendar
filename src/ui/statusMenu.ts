import { Menu } from 'obsidian';
import type { Task, TaskPriority } from '../parser/types';
import type { TaskStatusType } from '../settings/types';
import type { StatusRegistry } from '../status/StatusRegistry';

const PRIORITIES: Array<{ p: TaskPriority; label: string }> = [
  { p: 'A', label: 'Highest' },
  { p: 'B', label: 'High' },
  { p: 'C', label: 'Medium' },
  { p: 'D', label: 'None' },
  { p: 'E', label: 'Low' },
  { p: 'F', label: 'Lowest' },
];

export interface StatusMenuOpts {
  task: Task;
  registry: StatusRegistry;
  onPickStatus: (char: string) => void;
  onPickPriority: (p: TaskPriority) => void;
}

/** Runtime-only shape of Obsidian's MenuItem DOM root (undocumented in the public API). */
interface MenuItemWithDom {
  dom: HTMLElement;
}

/**
 * Builds the top "Priority" section of the combined menu: one checkable item per
 * priority level, each with a flag icon colored to match the existing priority
 * popover (`--tc-priority-a..f` CSS vars, via `.tc-menu-priority-flag[data-tc-priority]`).
 */
function addPrioritySection(
  menu: Menu,
  task: Task,
  onPickPriority: (p: TaskPriority) => void,
): void {
  for (const { p, label } of PRIORITIES) {
    menu.addItem((i) => {
      i.setTitle(label)
        .setSection('priority')
        .setChecked((task.priority ?? 'D') === p)
        .setIcon('flag')
        .onClick(() => onPickPriority(p));
      // `.dom` is an undocumented MenuItem internal; guard so a future
      // Obsidian refactor degrades to an uncolored flag instead of throwing
      // (an unguarded throw here would abort building the rest of the menu).
      const dom = (i as unknown as MenuItemWithDom).dom;
      if (dom) {
        dom.addClass('tc-menu-priority-flag');
        dom.setAttribute('data-tc-priority', p);
      }
      return i;
    });
  }
}

const GROUP_LABELS: Record<TaskStatusType, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

/**
 * Adds the status items (grouped by open/in-progress/done/cancelled) to `menu`,
 * one `setSection(group.type)` group per status type, current status checked.
 * Each group starts with a non-interactive label header (e.g. "To do") — inserted
 * before the group's items so it sorts to the top of its section.
 */
export function buildStatusSubmenu(
  sub: Menu,
  task: Task,
  registry: StatusRegistry,
  onPickStatus: (char: string) => void,
): void {
  for (const group of registry.grouped()) {
    sub.addItem((i) => {
      i.setTitle(GROUP_LABELS[group.type]).setSection(group.type).setIsLabel(true);
      return i;
    });
    for (const def of group.statuses) {
      sub.addItem((i) => {
        i.setTitle(def.name)
          .setSection(group.type)
          .setChecked(task.statusSymbol === def.symbol)
          .onClick(() => onPickStatus(def.symbol));
        if (def.iconKind === 'lucide' && def.icon) i.setIcon(def.icon);
        return i;
      });
    }
  }
}

/**
 * Builds the combined priority+status right-click menu: a Priority section on top
 * (registered first so Obsidian renders it above the status sections), followed by
 * status items grouped by `registry.grouped()` (open → in-progress → done → cancelled).
 */
export function buildStatusMenu(opts: StatusMenuOpts): Menu {
  const { task, registry, onPickStatus, onPickPriority } = opts;
  const menu = new Menu();
  addPrioritySection(menu, task, onPickPriority);
  buildStatusSubmenu(menu, task, registry, onPickStatus);
  return menu;
}

export function showStatusMenuAt(ev: MouseEvent, opts: StatusMenuOpts): void {
  buildStatusMenu(opts).showAtMouseEvent(ev);
}
