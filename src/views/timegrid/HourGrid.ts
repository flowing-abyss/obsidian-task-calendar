import { minutesToPixels, minutesToTimeString, pixelsToMinutes, snapMinutes } from './layout';

const DROP_SNAP_MINUTES = 15;

interface DayColumnHandles {
  date: string;
  hourColumnEl: HTMLElement;
  allDayCellEl: HTMLElement;
}

export interface HourGridHandles {
  rootEl: HTMLElement;
  gridRowEl: HTMLElement;
  days: DayColumnHandles[];
}

/** Render the static hour-grid + all-day band skeleton for the given dates (1 = Today, 7 = Week). */
export function renderHourGrid(
  container: HTMLElement,
  dates: string[],
  onDropTime?: (dragData: string, date: string, time: string) => void,
  onCreateAtTime?: (date: string, time: string) => void,
): HourGridHandles {
  container.empty();
  const root = container.createDiv({ cls: 'tc-tg-root' });

  // Day headers: weekday + day number per date, so multi-column views (Week)
  // can be read without cross-referencing the nav bar's week number.
  const today = window.moment().format('YYYY-MM-DD');
  const headerRow = root.createDiv({ cls: 'tc-tg-header-row' });
  headerRow.createDiv({ cls: 'tc-tg-header-gutter' });
  for (const date of dates) {
    const headerCell = headerRow.createDiv({
      cls: `tc-tg-header-cell${date === today ? ' is-today' : ''}`,
    });
    headerCell.textContent = window.moment(date).format('ddd D');
  }

  // All-day band: one cell per date
  const alldayRow = root.createDiv({ cls: 'tc-tg-allday-row' });
  alldayRow.createDiv({ cls: 'tc-tg-allday-gutter' });
  const alldayCells: HTMLElement[] = dates.map(() =>
    alldayRow.createDiv({ cls: 'tc-tg-allday-cell' }),
  );

  // Hour grid: a gutter with hour labels, plus one column per date
  const gridRow = root.createDiv({ cls: 'tc-tg-grid-row' });
  const gutter = gridRow.createDiv({ cls: 'tc-tg-hour-gutter' });
  for (let h = 0; h < 24; h++) {
    const label = gutter.createDiv({ cls: 'tc-tg-hour-label' });
    label.textContent = `${h.toString().padStart(2, '0')}:00`;
  }

  const days: DayColumnHandles[] = dates.map((date, i) => {
    const dayColumn = gridRow.createDiv({ cls: 'tc-tg-day-column' });
    // Lets CenterPanel locate a specific day's column from outside this module (e.g. to
    // anchor the click-to-create quick-add popover — see onCreateAtTime below).
    dayColumn.setAttribute('data-tg-date', date);
    for (let h = 0; h < 24; h++) {
      dayColumn.createDiv({ cls: 'tc-tg-hour-row' });
    }
    const hourColumnEl = dayColumn.createDiv({ cls: 'tc-tg-hour-column' });

    if (date === today) {
      const nowMinutes = window.moment().hours() * 60 + window.moment().minutes();
      const nowLine = hourColumnEl.createDiv({ cls: 'tc-tg-now-line' });
      nowLine.style.top = `${minutesToPixels(nowMinutes)}px`;
    }

    if (onDropTime) {
      hourColumnEl.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      hourColumnEl.addEventListener('drop', (e) => {
        e.preventDefault();
        const dragData = e.dataTransfer?.getData('text/plain');
        if (!dragData) return;
        const offsetY = e.clientY - hourColumnEl.getBoundingClientRect().top;
        const rawMinutes = pixelsToMinutes(offsetY);
        const snapped = Math.max(0, snapMinutes(rawMinutes, DROP_SNAP_MINUTES));
        onDropTime(dragData, date, minutesToTimeString(snapped));
      });
    }

    if (onCreateAtTime) {
      // Click-to-create: fires only for a click on genuinely empty space — not on an
      // existing timed block (dragged/clicked for its own context menu) and not on the
      // quick-add popover CenterPanel renders into this same column in response.
      hourColumnEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.tc-tg-block, .tc-tg-quick-add')) return;
        const offsetY = e.clientY - hourColumnEl.getBoundingClientRect().top;
        const rawMinutes = pixelsToMinutes(offsetY);
        const snapped = Math.max(0, snapMinutes(rawMinutes, DROP_SNAP_MINUTES));
        onCreateAtTime(date, minutesToTimeString(snapped));
      });
    }

    return { date, hourColumnEl, allDayCellEl: alldayCells[i]! };
  });

  return { rootEl: root, gridRowEl: gridRow, days };
}
