import { setIcon } from 'obsidian';
import type { SubTask, Task } from '../parser/types';
import type { StatusRegistry } from '../status/StatusRegistry';

interface Opts {
  task: Task | SubTask;
  registry: StatusRegistry;
  onLeftClick: () => void;
  onContextMenu: (ev: MouseEvent) => void;
}

export function renderStatusMarker(parent: HTMLElement, opts: Opts): HTMLElement {
  const { task, registry, onLeftClick, onContextMenu } = opts;
  const def = registry.bySymbol(task.statusSymbol);
  const el = parent.createSpan({ cls: 'tc-status-marker' });
  el.setAttribute('data-status', def?.id ?? 'other');
  el.setAttribute('data-status-type', def?.type ?? 'todo');
  if (task.priority && task.priority !== 'D') {
    el.setAttribute('data-priority', task.priority);
  }
  if (def?.color) el.style.setProperty('--tc-status-color', def.color);

  const icon = def?.icon ?? task.statusSymbol.trim();
  if (def && def.icon && def.iconKind === 'lucide') {
    setIcon(el, def.icon);
  } else if (icon) {
    el.setText(icon); // glyph/emoji, or unknown raw char
  } // else: empty chip (to-do)

  el.addEventListener('click', (e) => {
    e.preventDefault();
    onLeftClick();
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    onContextMenu(e);
  });
  return el;
}
