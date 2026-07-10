import { Component, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { buildDefaultTaskStatuses } from '../src/settings/defaults';
import { StatusRegistry } from '../src/status/StatusRegistry';
import { renderTimedBlocksForDay } from '../src/views/timegrid/renderTimedBlocks';
import { freshContainer, task } from './helpers';

const registry = new StatusRegistry(buildDefaultTaskStatuses());
const fakeApp = {} as App;

function callbacks() {
  return {
    app: fakeApp,
    component: new Component(),
    onTaskClick: vi.fn(),
    onTimeChange: vi.fn(),
    onDurationChange: vi.fn(),
    onToggle: vi.fn(),
    statusRegistry: registry,
  };
}

describe('renderTimedBlocksForDay', () => {
  it('does not set data-priority on the block (calendar blocks no longer render a priority border)', () => {
    const container = freshContainer();
    const t = task({ time: '09:00', priority: 'A' });
    renderTimedBlocksForDay(container, [t], {
      app: fakeApp,
      component: new Component(),
      onTaskClick: vi.fn(),
      onTimeChange: vi.fn(),
      onDurationChange: vi.fn(),
      onToggle: vi.fn(),
      statusRegistry: registry,
    });
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    expect(block.hasAttribute('data-priority')).toBe(false);
  });

  it('wraps the status marker and title together in a .tc-tg-block-head row, marker first', () => {
    const container = freshContainer();
    const t = task({ time: '09:00' });
    renderTimedBlocksForDay(container, [t], callbacks());
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    const head = block.querySelector('.tc-tg-block-head') as HTMLElement;
    expect(head).not.toBeNull();
    const marker = head.querySelector('.tc-status-marker');
    const title = head.querySelector('.tc-tg-block-title');
    expect(marker).not.toBeNull();
    expect(title).not.toBeNull();
    expect(head.firstElementChild).toBe(marker);
    expect(marker?.nextElementSibling).toBe(title);
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
      app: fakeApp,
      component: new Component(),
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
        app: fakeApp,
        component: new Component(),
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

  it('shows the start time with duration in parentheses in the block subtitle', () => {
    const container = freshContainer();
    const t = task({ time: '15:00', duration: 90 });
    renderTimedBlocksForDay(container, [t], callbacks());
    const subtitle = container.querySelector('.tc-tg-block-subtitle') as HTMLElement;
    expect(subtitle).not.toBeNull();
    expect(subtitle.textContent).toBe('15:00 (1h30m)');
  });

  it('defaults duration to 60min when unset, shown as "(1h)" in the subtitle', () => {
    const container = freshContainer();
    const t = task({ time: '09:00' });
    renderTimedBlocksForDay(container, [t], callbacks());
    const subtitle = container.querySelector('.tc-tg-block-subtitle') as HTMLElement;
    expect(subtitle.textContent).toBe('09:00 (1h)');
  });

  it('renders the subtitle before the head row (time+duration at the top of the block)', () => {
    const container = freshContainer();
    const t = task({ time: '09:00' });
    renderTimedBlocksForDay(container, [t], callbacks());
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    const subtitle = block.querySelector('.tc-tg-block-subtitle');
    const head = block.querySelector('.tc-tg-block-head');
    expect(subtitle).not.toBeNull();
    expect(head).not.toBeNull();
    expect(Array.from(block.children).indexOf(subtitle as Element)).toBeLessThan(
      Array.from(block.children).indexOf(head as Element),
    );
  });

  it('renders one block per timed task, positioned by time and sized by duration', () => {
    const container = freshContainer();
    const t = task({ time: '15:00', duration: 120, text: 'Gym' });
    renderTimedBlocksForDay(container, [t], {
      app: fakeApp,
      component: new Component(),
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
      app: fakeApp,
      component: new Component(),
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
      app: fakeApp,
      component: new Component(),
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
      app: fakeApp,
      component: new Component(),
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
      app: fakeApp,
      component: new Component(),
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
      app: fakeApp,
      component: new Component(),
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
      app: fakeApp,
      component: new Component(),
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
      app: fakeApp,
      component: new Component(),
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
      app: fakeApp,
      component: new Component(),
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

  it('renders the title via renderTaskText (markdown-link-aware), not raw textContent, for a task with a [[wikilink]]', () => {
    const container = freshContainer();
    const t = task({ time: '09:00', text: 'see [[Note]]', markdownText: 'see [[Note]]' });
    renderTimedBlocksForDay(container, [t], callbacks());
    const title = container.querySelector('.tc-tg-block-title') as HTMLElement;
    // renderTaskText only wraps in a `.tc-md` holder (and defers to MarkdownRenderer) when it
    // detects link syntax — a plain `.textContent =` assignment would show the raw brackets
    // instead of taking this path. MarkdownRenderer itself is a noop in this test harness (see
    // test/center-panel-integration.test.ts and friends), so real <a> production is not
    // observable here; the `.tc-md` holder is the reliable signal that markdown rendering (not
    // raw text) is in effect, matching this codebase's existing MarkdownRenderer-mock convention.
    expect(title.querySelector('.tc-md')).not.toBeNull();
  });

  it('renders plain title text (no [[links]]) via the renderTaskText fast path, unchanged from before', () => {
    const container = freshContainer();
    const t = task({ time: '09:00', text: 'Gym', markdownText: 'Gym' });
    renderTimedBlocksForDay(container, [t], callbacks());
    const title = container.querySelector('.tc-tg-block-title') as HTMLElement;
    expect(title.querySelector('.tc-md')).toBeNull();
    expect(title.textContent).toBe('Gym');
  });

  it('a real pointerdown→pointerup→click sequence on a rendered link inside the title fires only the link click, never onTimeChange (regression: link click must not arm drag, mirroring the status-marker fix)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({
      time: '09:00',
      duration: 60,
      text: 'see [[Note]]',
      markdownText: 'see [[Note]]',
    });
    renderTimedBlocksForDay(container, [t], cbs);
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    block.setPointerCapture = () => {};
    block.releasePointerCapture = () => {};
    // renderTaskText's MarkdownRenderer.render is a noop in this test harness, so simulate the
    // real post-render DOM it would eventually produce: an <a> inside the title holder.
    const holder = block.querySelector('.tc-md') as HTMLElement;
    const link = holder.createEl('a', { cls: 'internal-link', text: 'Note' });
    // Real browser event order for a click on a nested link: pointerdown bubbles first, then
    // pointerup, then click — reproduced here exactly, targeting the link.
    link.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1 }),
    );
    window.dispatchEvent(new PointerEvent('pointerup', { clientY: 100, pointerId: 1 }));
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(cbs.onTimeChange).not.toHaveBeenCalled();
    expect(cbs.onDurationChange).not.toHaveBeenCalled();
  });

  it('dragging that starts on the title text itself (not a link) still arms move and fires onTimeChange (guard is link-specific, not title-wide)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ time: '09:00', duration: 60, text: 'Gym', markdownText: 'Gym' });
    renderTimedBlocksForDay(container, [t], cbs);
    const block = container.querySelector('.tc-tg-block') as HTMLElement;
    block.setPointerCapture = () => {};
    block.releasePointerCapture = () => {};
    const title = container.querySelector('.tc-tg-block-title') as HTMLElement;
    title.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1 }),
    );
    window.dispatchEvent(new PointerEvent('pointermove', { clientY: 148, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientY: 148, pointerId: 1 }));
    expect(cbs.onTimeChange).toHaveBeenCalledWith(t, 9 * 60 + 60);
  });

  it('a stationary right-click on the resize handle does NOT fire onDurationChange', () => {
    const container = freshContainer();
    const onDurationChange = vi.fn();
    const t = task({ time: '09:00', duration: 60 });
    renderTimedBlocksForDay(container, [t], {
      app: fakeApp,
      component: new Component(),
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
