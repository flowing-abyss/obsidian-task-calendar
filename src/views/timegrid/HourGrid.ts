export interface DayColumnHandles {
  date: string;
  hourColumnEl: HTMLElement;
  allDayCellEl: HTMLElement;
}

export interface HourGridHandles {
  rootEl: HTMLElement;
  days: DayColumnHandles[];
}

/** Render the static hour-grid + all-day band skeleton for the given dates (1 = Today, 7 = Week). */
export function renderHourGrid(container: HTMLElement, dates: string[]): HourGridHandles {
  container.empty();
  const root = container.createDiv({ cls: 'tc-tg-root' });

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
    for (let h = 0; h < 24; h++) {
      dayColumn.createDiv({ cls: 'tc-tg-hour-row' });
    }
    const hourColumnEl = dayColumn.createDiv({ cls: 'tc-tg-hour-column' });
    return { date, hourColumnEl, allDayCellEl: alldayCells[i]! };
  });

  return { rootEl: root, days };
}
