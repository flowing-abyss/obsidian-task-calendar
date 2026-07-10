import { describe, expect, it, vi } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { renderTimedBlocksForDay } from '../src/views/timegrid/renderTimedBlocks';
import { freshContainer, task } from './helpers';

const registry = new StatusRegistry(buildDefaultTaskStatuses());

function callbacks() {
  return {
    onTaskClick: vi.fn(),
    onTimeChange: vi.fn(),
    onDurationChange: vi.fn(),
    onToggle: vi.fn(),
    statusRegistry: registry,
  };
}

describe('renderTimedBlocksForDay', () => {
  it('sets data-priority on the block for a prioritized task', () => {
    const container = freshContainer();
    const t = task({ time: '09:00', priority: 'A' });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick: vi.fn(),
      onTimeChange: vi.fn(),
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    expect(block.getAttribute('data-priority')).toBe('A');
  });

  it('renders a status marker as the first child of the block', () => {
    const container = freshContainer();
    const t = task({ time: '09:00' });
    renderTimedBlocksForDay(container, [t], callbacks());
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    const marker = block.querySelector('.tc-status-marker');
    expect(marker).not.toBeNull();
    expect(block.firstElementChild).toBe(marker);
  });

  it('clicking the status marker fires onToggle with the task, not onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ time: '09:00' });
    renderTimedBlocksForDay(container, [t], cbs);
    const marker = container.querySelector('.tc-status-marker') as HTMLElement;
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onToggle).toHaveBeenCalledWith(t);
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('a real pointerdown→pointerup→click sequence on the status marker (no movement) fires only onToggle, never onTimeChange/onDurationChange', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ time: '09:00', duration: 60 });
    renderTimedBlocksForDay(container, [t], cbs);
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    block.setPointerCapture = () => {};
    block.releasePointerCapture = () => {};
    const marker = container.querySelector('.tc-status-marker') as HTMLElement;
    // Real browser event order for a click on a child element: pointerdown bubbles first,
    // then pointerup, then click — reproduced here exactly, targeting the marker.
    marker.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1 }),
    );
    window.dispatchEvent(new PointerEvent('pointerup', { clientY: 100, pointerId: 1 }));
    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onToggle).toHaveBeenCalledWith(t);
    expect(cbs.onTimeChange).not.toHaveBeenCalled();
    expect(cbs.onDurationChange).not.toHaveBeenCalled();
  });

  it('omits data-priority entirely when the task has no priority (D)', () => {
    const container = freshContainer();
    const t = task({ time: '09:00', priority: 'D' });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick: vi.fn(),
      onTimeChange: vi.fn(),
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    expect(block.hasAttribute('data-priority')).toBe(false);
  });

  it('sets --tc-tag-color when the task has a tag matching a configured tag group', () => {
    const container = freshContainer();
    const t = task({ time: '09:00', rawText: '- [ ] t #work' });
    renderTimedBlocksForDay(
      container,
      [t],
      {
        onTaskClick: vi.fn(),
        onTimeChange: vi.fn(),
        onDurationChange: vi.fn(),
        onToggle: vi.fn(),
        statusRegistry: registry,
      },
      [{ id: '1', name: 'Work', mode: 'prefix', prefix: 'work', color: '#3498db' }],
    );
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    expect(block.style.getPropertyValue('--tc-tag-color')).toBe('#3498db');
  });

  it('renders one block per timed task, positioned by time and sized by duration', () => {
    const container = freshContainer();
    const t = task({ time: '15:00', duration: 120, text: 'Gym' });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick: vi.fn(),
      onTimeChange: vi.fn(),
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.style.top).toBe(`${((15 * 60) / 60) * 48}px`);
    expect(block.style.height).toBe(`${(120 / 60) * 48}px`);
    expect(block.textContent).toContain('Gym');
  });

  it('defaults duration to 60 minutes when unset', () => {
    const container = freshContainer();
    const t = task({ time: '09:00' });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick: vi.fn(),
      onTimeChange: vi.fn(),
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    expect(block.style.height).toBe('48px');
  });

  it('a plain click does NOT fire onTaskClick (reserved for drag)', () => {
    const container = freshContainer();
    const onTaskClick = vi.fn();
    const t = task({ time: '09:00' });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick,
      onTimeChange: vi.fn(),
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    block.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it('a right-click (contextmenu) fires onTaskClick', () => {
    const container = freshContainer();
    const onTaskClick = vi.fn();
    const t = task({ time: '09:00' });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick,
      onTimeChange: vi.fn(),
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    block.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(onTaskClick).toHaveBeenCalledWith(t);
  });

  it('right-clicking the resize handle does NOT fire onTaskClick', () => {
    const container = freshContainer();
    const onTaskClick = vi.fn();
    const t = task({ time: '09:00' });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick,
      onTimeChange: vi.fn(),
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const handle = container.querySelector('.tc-tg-resize-handle') as HTMLElement;
    handle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(onTaskClick).not.toHaveBeenCalled();
  });

  it('two overlapping blocks are given proportional widths/left offsets (no visual overlap)', () => {
    const container = freshContainer();
    const a = task({ time: '09:00', duration: 60, line: 0 });
    const b = task({ time: '09:30', duration: 60, line: 1 });
    renderTimedBlocksForDay(container, [a, b], {
      onTaskClick: vi.fn(),
      onTimeChange: vi.fn(),
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const blocks = Array.from(container.querySelectorAll<HTMLElement>('.tc-tg-block'));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.style.width).toBe('50%');
    expect(blocks[1]!.style.width).toBe('50%');
    expect(blocks[0]!.style.left).not.toBe(blocks[1]!.style.left);
  });

  it('dragging the block body by one hour snaps to 15-minute steps and fires onTimeChange on pointerup', () => {
    const container = freshContainer();
    const onTimeChange = vi.fn();
    const t = task({ time: '09:00', duration: 60 });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick: vi.fn(),
      onTimeChange,
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    block.setPointerCapture = () => {}; // jsdom stub
    block.releasePointerCapture = () => {};
    block.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1 }),
    );
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: 148, pointerId: 1 })); // +48px = +60min
    window.dispatchEvent(new PointerEvent('pointerup', { clientY: 148, pointerId: 1 }));
    expect(onTimeChange).toHaveBeenCalledWith(t, 9 * 60 + 60);
  });

  it('dragging the resize handle fires onDurationChange, not onTimeChange', () => {
    const container = freshContainer();
    const onDurationChange = vi.fn();
    const onTimeChange = vi.fn();
    const t = task({ time: '09:00', duration: 60 });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick: vi.fn(),
      onTimeChange,
      onDurationChange,
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const handle = container.querySelector('.tc-tg-resize-handle') as HTMLElement;
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    handle.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1 }),
    );
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: 148, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientY: 148, pointerId: 1 }));
    expect(onDurationChange).toHaveBeenCalledWith(t, 120);
    expect(onTimeChange).not.toHaveBeenCalled();
  });

  it('a stationary right-click (pointerdown button=2, pointerup at same position, no move) does NOT fire onTimeChange', () => {
    const container = freshContainer();
    const onTimeChange = vi.fn();
    const t = task({ time: '09:00', duration: 60 });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick: vi.fn(),
      onTimeChange,
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    block.setPointerCapture = () => {};
    block.releasePointerCapture = () => {};
    block.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1, button: 2 }),
    );
    // No pointermove — a real stationary right-click never moves the pointer.
    window.dispatchEvent(new PointerEvent('pointerup', { clientY: 100, pointerId: 1, button: 2 }));
    expect(onTimeChange).not.toHaveBeenCalled();
  });

  it('a stationary right-click on the resize handle does NOT fire onDurationChange', () => {
    const container = freshContainer();
    const onDurationChange = vi.fn();
    const t = task({ time: '09:00', duration: 60 });
    renderTimedBlocksForDay(container, [t], {
      onTaskClick: vi.fn(),
      onTimeChange: vi.fn(),
      onDurationChange,
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const handle = container.querySelector('.tc-tg-resize-handle') as HTMLElement;
    handle.setPointerCapture = () => {};
    handle.releasePointerCapture = () => {};
    handle.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1, button: 2 }),
    );
    window.dispatchEvent(new PointerEvent('pointerup', { clientY: 100, pointerId: 1, button: 2 }));
    expect(onDurationChange).not.toHaveBeenCalled();
  });
});
