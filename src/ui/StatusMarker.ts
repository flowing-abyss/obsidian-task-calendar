import { setIcon } from 'obsidian';
import type { SubTask, Task } from '../parser/types';
import type { StatusRegistry } from '../status/StatusRegistry';

interface Opts {
  task: Task | SubTask;
  registry: StatusRegistry;
  onLeftClick: () => void;
  onContextMenu: (ev: MouseEvent) => void;
}

// Lucide icons are identical for every marker sharing an icon id; building the
// svg via `setIcon` once and cloning it is far cheaper than re-running
// `setIcon` for every marker (hundreds in a non-virtualized calendar view).
const ICON_CACHE = new Map<string, SVGElement>();

function getLucideIcon(iconId: string): SVGElement | null {
  let svg = ICON_CACHE.get(iconId);
  if (svg) return svg.cloneNode(true) as SVGElement;

  const scratch = activeDocument.createElement('span');
  setIcon(scratch, iconId);
  svg = scratch.querySelector('svg') ?? undefined;
  if (!svg) return null;
  ICON_CACHE.set(iconId, svg);
  return svg.cloneNode(true) as SVGElement;
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
    const svg = getLucideIcon(def.icon);
    if (svg) el.appendChild(svg);
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
