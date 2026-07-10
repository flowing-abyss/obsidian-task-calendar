import { describe, expect, it, vi } from 'vitest';
import { renderAllDayCell } from '../src/views/timegrid/renderAllDay';
import { dispatchDnD, freshContainer, task } from './helpers';

const callbacks = () => ({
  onTaskClick: vi.fn(),
  onDrop: vi.fn(),
  onStartChange: vi.fn(),
  onDueChange: vi.fn(),
});

describe('renderAllDayCell', () => {
  it('sets data-priority on a plain chip and span for a prioritized task, omits it for D', () => {
    const container = freshContainer();
    const prioritized = task({ due: '2026-07-10', priority: 'B', text: 'Plain' });
    renderAllDayCell(container, '2026-07-10', [], [prioritized], [], callbacks());
    const chip = container.querySelector('.tc-tg-plain') as HTMLElement;
    expect(chip.getAttribute('data-priority')).toBe('B');

    const container2 = freshContainer();
    const none = task({ due: '2026-07-10', priority: 'D', text: 'Plain' });
    renderAllDayCell(container2, '2026-07-10', [], [none], [], callbacks());
    const chip2 = container2.querySelector('.tc-tg-plain') as HTMLElement;
    expect(chip2.hasAttribute('data-priority')).toBe(false);
  });

  it('sets --tc-tag-color on a plain chip when a tag matches a configured tag group', () => {
    const container = freshContainer();
    const t = task({ due: '2026-07-10', rawText: '- [ ] t #work', text: 'Plain' });
    renderAllDayCell(container, '2026-07-10', [], [t], [], callbacks(), [
      { id: '1', name: 'Work', mode: 'prefix', prefix: 'work', color: '#3498db' },
    ]);
    const chip = container.querySelector('.tc-tg-plain') as HTMLElement;
    expect(chip.style.getPropertyValue('--tc-tag-color')).toBe('#3498db');
  });

  it('sets data-priority on a deadline marker but never --tc-tag-color (structural pill, no fill)', () => {
    const container = freshContainer();
    const t = task({
      due: '2026-07-10',
      scheduled: '2026-07-05',
      priority: 'A',
      rawText: '- [ ] t #work 📅 2026-07-10',
      text: 'Deadline',
    });
    renderAllDayCell(container, '2026-07-10', [], [], [t], callbacks(), [
      { id: '1', name: 'Work', mode: 'prefix', prefix: 'work', color: '#3498db' },
    ]);
    const marker = container.querySelector('.tc-tg-deadline-marker') as HTMLElement;
    expect(marker.getAttribute('data-priority')).toBe('A');
    expect(marker.style.getPropertyValue('--tc-tag-color')).toBe('');
  });

  it('renders a plain task as a draggable chip', () => {
    const container = freshContainer();
    const t = task({ due: '2026-07-10', text: 'Plain' });
    renderAllDayCell(container, '2026-07-10', [], [t], [], callbacks());
    const chip = container.querySelector('.tc-tg-plain') as HTMLElement;
    expect(chip.getAttribute('draggable')).toBe('true');
    expect(chip.textContent).toContain('Plain');
  });

  it('renders a span as a filled bar, draggable', () => {
    const container = freshContainer();
    const t = task({ start: '2026-07-08', due: '2026-07-12', text: 'Trip' });
    renderAllDayCell(container, '2026-07-10', [t], [], [], callbacks());
    const bar = container.querySelector('.tc-tg-span') as HTMLElement;
    expect(bar.getAttribute('draggable')).toBe('true');
  });

  it('renders edge handles only on the day matching start/due, not on mid-span days', () => {
    const t = task({ start: '2026-07-08', due: '2026-07-12', text: 'Trip' });

    const startContainer = freshContainer();
    renderAllDayCell(startContainer, '2026-07-08', [t], [], [], callbacks());
    expect(startContainer.querySelector('.tc-tg-span-edge--left')).not.toBeNull();
    expect(startContainer.querySelector('.tc-tg-span-edge--right')).toBeNull();

    const midContainer = freshContainer();
    renderAllDayCell(midContainer, '2026-07-10', [t], [], [], callbacks());
    expect(midContainer.querySelector('.tc-tg-span-edge--left')).toBeNull();
    expect(midContainer.querySelector('.tc-tg-span-edge--right')).toBeNull();

    const dueContainer = freshContainer();
    renderAllDayCell(dueContainer, '2026-07-12', [t], [], [], callbacks());
    expect(dueContainer.querySelector('.tc-tg-span-edge--left')).toBeNull();
    expect(dueContainer.querySelector('.tc-tg-span-edge--right')).not.toBeNull();
  });

  it('renders a deadline marker as non-draggable, structurally distinct from a plain chip', () => {
    const container = freshContainer();
    const t = task({ due: '2026-07-10', scheduled: '2026-07-05', text: 'Deadline' });
    renderAllDayCell(container, '2026-07-10', [], [], [t], callbacks());
    const marker = container.querySelector('.tc-tg-deadline-marker') as HTMLElement;
    expect(marker).not.toBeNull();
    expect(marker.hasAttribute('draggable')).toBe(false);
    expect(container.querySelector('.tc-tg-plain')).toBeNull();
    expect(container.querySelector('.tc-tg-span')).toBeNull();
  });

  it('a plain click on a plain chip does NOT fire onTaskClick (reserved for drag)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ due: '2026-07-10', text: 'Plain' });
    renderAllDayCell(container, '2026-07-10', [], [t], [], cbs);
    (container.querySelector('.tc-tg-plain') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('a right-click (contextmenu) on a plain chip fires onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ due: '2026-07-10', text: 'Plain' });
    renderAllDayCell(container, '2026-07-10', [], [t], [], cbs);
    (container.querySelector('.tc-tg-plain') as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(cbs.onTaskClick).toHaveBeenCalledWith(t);
  });

  it('a plain click on a span body does NOT fire onTaskClick (reserved for drag)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ start: '2026-07-08', due: '2026-07-12', text: 'Trip' });
    renderAllDayCell(container, '2026-07-10', [t], [], [], cbs);
    (container.querySelector('.tc-tg-span') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('a right-click (contextmenu) on a span body fires onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ start: '2026-07-08', due: '2026-07-12', text: 'Trip' });
    renderAllDayCell(container, '2026-07-10', [t], [], [], cbs);
    (container.querySelector('.tc-tg-span') as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(cbs.onTaskClick).toHaveBeenCalledWith(t);
  });

  it('a plain click on a deadline marker does NOT fire onTaskClick (reserved for drag)', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ due: '2026-07-10', scheduled: '2026-07-05', text: 'Deadline' });
    renderAllDayCell(container, '2026-07-10', [], [], [t], cbs);
    (container.querySelector('.tc-tg-deadline-marker') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(cbs.onTaskClick).not.toHaveBeenCalled();
  });

  it('a right-click (contextmenu) on a deadline marker fires onTaskClick', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ due: '2026-07-10', scheduled: '2026-07-05', text: 'Deadline' });
    renderAllDayCell(container, '2026-07-10', [], [], [t], cbs);
    (container.querySelector('.tc-tg-deadline-marker') as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    expect(cbs.onTaskClick).toHaveBeenCalledWith(t);
  });

  it("dropping onto the cell fires onDrop with the payload and this cell's date", () => {
    const container = freshContainer();
    const cbs = callbacks();
    renderAllDayCell(container, '2026-07-10', [], [], [], cbs);
    dispatchDnD(container, 'drop', 'f.md:::0');
    expect(cbs.onDrop).toHaveBeenCalledWith('f.md:::0', '2026-07-10');
  });

  it("pointer-dragging a span's right edge fires onDueChange on pointerup", () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ start: '2026-07-08', due: '2026-07-10', text: 'Trip' });
    // Right (due) edge handle only renders on the due-date cell, per the rule that
    // edge handles appear only on the day matching start/due respectively.
    renderAllDayCell(container, '2026-07-10', [t], [], [], cbs);
    const rightHandle = container.querySelector('.tc-tg-span-edge--right') as HTMLElement;
    rightHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    // jsdom's document.elementFromPoint always returns null, so real coordinate-based
    // resolution can't be exercised here. This test drives the deterministic seam
    // (__tgTestEndDrag) that renderAllDayCell exposes on the cell for this purpose;
    // real usage resolves the target date via document.elementFromPoint in the
    // pointerup handler itself.
    (container as unknown as { __tgTestEndDrag: (date: string) => void }).__tgTestEndDrag(
      '2026-07-11',
    );
    expect(cbs.onDueChange).toHaveBeenCalledWith(t, '2026-07-11');
  });

  it("pointer-dragging a span's left edge fires onStartChange on pointerup", () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ start: '2026-07-08', due: '2026-07-10', text: 'Trip' });
    renderAllDayCell(container, '2026-07-08', [t], [], [], cbs);
    const leftHandle = container.querySelector('.tc-tg-span-edge--left') as HTMLElement;
    leftHandle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    (container as unknown as { __tgTestEndDrag: (date: string) => void }).__tgTestEndDrag(
      '2026-07-07',
    );
    expect(cbs.onStartChange).toHaveBeenCalledWith(t, '2026-07-07');
    expect(cbs.onDueChange).not.toHaveBeenCalled();
  });

  it('a stationary right-click (pointerdown button=2, pointerup at same position, no move) on an edge handle does NOT fire onStartChange/onDueChange', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ start: '2026-07-08', due: '2026-07-10', text: 'Trip' });
    renderAllDayCell(container, '2026-07-08', [t], [], [], cbs);
    const leftHandle = container.querySelector('.tc-tg-span-edge--left') as HTMLElement;
    // Simulate a real browser resolving an element under a stationary cursor (jsdom's
    // elementFromPoint always returns null, unlike a real browser where a right-click on
    // the edge handle would resolve to the day cell beneath it).
    const originalElementFromPoint = activeDocument.elementFromPoint;
    activeDocument.elementFromPoint = () => container;
    try {
      leftHandle.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 1,
          button: 2,
          clientX: 5,
          clientY: 5,
        }),
      );
      // No pointermove — a real stationary right-click never moves the pointer.
      window.dispatchEvent(
        new PointerEvent('pointerup', { pointerId: 1, button: 2, clientX: 5, clientY: 5 }),
      );
    } finally {
      activeDocument.elementFromPoint = originalElementFromPoint;
    }
    expect(cbs.onStartChange).not.toHaveBeenCalled();
    expect(cbs.onDueChange).not.toHaveBeenCalled();
  });
});
