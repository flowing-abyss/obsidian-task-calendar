import { setIcon } from 'obsidian';
import type { StatusRegistry } from '../status/StatusRegistry';
import type { TaskPriority } from '../tasks';

interface Opts {
  // Structural type: only statusSymbol/priority are read, so Task/SubTask
  // satisfy this without a cast, and callers needing a fake stand-in task
  // (menus/previews) can pass a plain object literal instead of a cast.
  task: { statusSymbol: string; priority?: TaskPriority };
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

  if (def && def.icon) {
    const svg = getLucideIcon(def.icon);
    if (svg) el.appendChild(svg);
  } else if (!def) {
    // Unknown symbol (not in the status table): fall back to the raw glyph
    // in a neutral tone rather than rendering an empty chip.
    const raw = task.statusSymbol.trim();
    if (raw) el.setText(raw);
  } // else: def with icon === '' → empty chip (plain to-do)

  el.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onLeftClick();
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    onContextMenu(e);
  });
  return el;
}
