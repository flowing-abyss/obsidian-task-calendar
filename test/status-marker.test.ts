import { addIcon } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { renderStatusMarker } from '../src/ui/StatusMarker';

const reg = new StatusRegistry(buildDefaultTaskStatuses());

describe('renderStatusMarker', () => {
  it('renders a chip with the type + priority data attrs and an icon (no color)', () => {
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
    expect(el.style.getPropertyValue('--tc-status-color')).toBe('');
  });

  it('renders the in-progress group with data-status-type used for circular shape', () => {
    const parent = document.createElement('div');
    const el = renderStatusMarker(parent, {
      task: { statusSymbol: '/', priority: 'D' } as any,
      registry: reg,
      onLeftClick: () => {},
      onContextMenu: () => {},
    });
    expect(el.getAttribute('data-status-type')).toBe('in-progress');
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

  it('stops click propagation so a parent card click handler does not also fire', () => {
    const parent = document.createElement('div');
    const parentClick = vi.fn();
    parent.addEventListener('click', parentClick);
    const left = vi.fn();
    const el = renderStatusMarker(parent, {
      task: { statusSymbol: 'x', priority: 'D' } as any,
      registry: reg,
      onLeftClick: left,
      onContextMenu: () => {},
    });
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(left).toHaveBeenCalledOnce();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('renders an <svg> child for a status with an icon (e.g. Done)', () => {
    addIcon('check', '<svg><path d="M20 6 9 17l-5-5"/></svg>');
    const parent = document.createElement('div');
    const el = renderStatusMarker(parent, {
      task: { statusSymbol: 'x', priority: 'D' } as any,
      registry: reg,
      onLeftClick: () => {},
      onContextMenu: () => {},
    });
    const svg = el.querySelector('svg');
    expect(svg).not.toBeNull();
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
