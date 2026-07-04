import { describe, expect, it, vi } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { renderStatusMarker } from '../src/ui/StatusMarker';

const reg = new StatusRegistry(buildDefaultTaskStatuses());

describe('renderStatusMarker', () => {
  it('renders a chip with the status color and data attrs', () => {
    const parent = document.createElement('div');
    const el = renderStatusMarker(parent, {
      task: { statusSymbol: '!', priority: 'A' } as any,
      registry: reg,
      onLeftClick: () => {},
      onContextMenu: () => {},
    });
    expect(el.classList.contains('tc-status-marker')).toBe(true);
    expect(el.getAttribute('data-status-type')).toBe('todo');
    expect(el.getAttribute('data-priority')).toBe('A');
  });

  it('renders an empty chip for to-do (no icon)', () => {
    const parent = document.createElement('div');
    const el = renderStatusMarker(parent, {
      task: { statusSymbol: ' ', priority: 'D' } as any,
      registry: reg,
      onLeftClick: () => {},
      onContextMenu: () => {},
    });
    expect(el.getAttribute('data-priority')).toBeNull(); // D → no ring
    expect(el.textContent).toBe('');
  });

  it('fires callbacks on click and contextmenu', () => {
    const parent = document.createElement('div');
    const left = vi.fn();
    const ctx = vi.fn();
    const el = renderStatusMarker(parent, {
      task: { statusSymbol: 'x', priority: 'D' } as any,
      registry: reg,
      onLeftClick: left,
      onContextMenu: ctx,
    });
    el.dispatchEvent(new MouseEvent('click'));
    el.dispatchEvent(new MouseEvent('contextmenu'));
    expect(left).toHaveBeenCalledOnce();
    expect(ctx).toHaveBeenCalledOnce();
  });

  it('renders unknown status glyph on neutral chip', () => {
    const parent = document.createElement('div');
    const el = renderStatusMarker(parent, {
      task: { statusSymbol: '@', priority: 'D' } as any,
      registry: reg,
      onLeftClick: () => {},
      onContextMenu: () => {},
    });
    expect(el.getAttribute('data-status')).toBe('other');
    expect(el.textContent).toBe('@');
  });
});
