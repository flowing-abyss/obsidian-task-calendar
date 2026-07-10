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

  it('clicking any of the three shapes fires onTaskClick with that task', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ due: '2026-07-10', text: 'Plain' });
    renderAllDayCell(container, '2026-07-10', [], [t], [], cbs);
    (container.querySelector('.tc-tg-plain') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(cbs.onTaskClick).toHaveBeenCalledWith(t);
  });

  it('clicking a deadline marker fires onTaskClick with that task', () => {
    const container = freshContainer();
    const cbs = callbacks();
    const t = task({ due: '2026-07-10', scheduled: '2026-07-05', text: 'Deadline' });
    renderAllDayCell(container, '2026-07-10', [], [], [t], cbs);
    (container.querySelector('.tc-tg-deadline-marker') as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
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
});
