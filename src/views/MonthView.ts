import type { Task } from '../parser/types'
import type { ResolvedConfig } from '../settings/types'
import { createTaskCard } from '../ui/TaskCard'
import { BaseView } from './BaseView'
import { getTasksForDate, sortTasks } from './taskGrouping'

export interface MonthViewCallbacks {
  onToggle: (task: Task) => void
  onCellClick: (date: string) => void
  onWeekClick: (weekNr: string, year: string) => void
}

export class MonthView extends BaseView {
  private containerEl: HTMLElement | null = null

  constructor(private callbacks: MonthViewCallbacks) {
    super()
  }

  render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    this.containerEl = container
    container.empty()

    const today = window.moment().format('YYYY-MM-DD')
    const tDay = window.moment().format('d')
    const tMonth = window.moment().format('M')
    const tYear = window.moment().format('YYYY')

    const month = config.startPosition
      ? window.moment(config.startPosition, 'YYYY-MM').date(1)
      : window.moment().date(1)

    const firstDayOfMonth = parseInt(window.moment(month).format('d'))
    const lastDateOfMonth = parseInt(window.moment(month).endOf('month').format('D'))

    const grid = container.createDiv('grid')

    // Day headers row
    const gridHeads = grid.createDiv('gridHeads')
    gridHeads.createDiv('gridHead') // empty corner for week number column

    for (
      let h = 0 - firstDayOfMonth + config.firstDayOfWeek;
      h < 7 - firstDayOfMonth + config.firstDayOfWeek;
      h++
    ) {
      const m = window.moment(month).add(h, 'days')
      const weekDayNr = m.format('d')
      const isToday =
        tDay === weekDayNr &&
        tMonth === window.moment(month).format('M') &&
        tYear === window.moment(month).format('YYYY')

      const head = gridHeads.createDiv({ cls: isToday ? 'gridHead today' : 'gridHead' })
      head.setAttribute('data-weekday', weekDayNr)
      head.textContent = m.format('ddd')
    }

    // Week rows
    const wrappersEl = grid.createDiv('wrappers')
    wrappersEl.setAttribute(
      'data-month',
      window.moment(month).format('MMM').replace('.', '').substring(0, 3),
    )

    let starts = 0 - firstDayOfMonth + config.firstDayOfWeek

    for (let w = 1; w < 7; w++) {
      const weekNr = window.moment(month).add(starts, 'days').format('w')
      const yearNr = window.moment(month).add(starts, 'days').format('YYYY')

      const wrapper = wrappersEl.createDiv('wrapper')
      const wBtn = wrapper.createDiv('wrapperButton')
      wBtn.setAttribute('data-week', weekNr)
      wBtn.setAttribute('data-year', yearNr)
      wBtn.textContent = 'W' + weekNr
      wBtn.addEventListener('click', () => this.callbacks.onWeekClick(weekNr, yearNr))

      for (let i = starts; i < starts + 7; i++) {
        const currentDate = window.moment(month).add(i, 'days').format('YYYY-MM-DD')
        const weekDay = window.moment(month).add(i, 'days').format('d')
        const isFirstOfMonth = window.moment(month).add(i, 'days').format('D') === '1'
        const dayLabel = isFirstOfMonth
          ? window.moment(month).add(i, 'days').format('D. MMM')
          : window.moment(month).add(i, 'days').format('D')
        const inCurrentMonth =
          window.moment(month).format('MM') === window.moment(month).add(i, 'days').format('MM')

        let cellCls = 'cell '
        if (i < 0) cellCls += 'prevMonth'
        else if (i >= lastDateOfMonth) cellCls += 'nextMonth'
        else if (currentDate === today) cellCls += 'currentMonth today'
        else cellCls += 'currentMonth'
        if (isFirstOfMonth) cellCls += ' newMonth'

        const cell = wrapper.createDiv({ cls: cellCls })
        cell.setAttribute('data-weekday', weekDay)

        const dailyNotePath = config.dailyNoteFolder
          ? `${config.dailyNoteFolder}/${currentDate}`
          : currentDate
        const cellLink = cell.createEl('a', { cls: 'internal-link cellName', href: dailyNotePath })
        cellLink.textContent = dayLabel

        const cellContent = cell.createDiv('cellContent')

        // Render tasks for all visible cells (prev month, current month, next month)
        this.renderTasksForDate(cellContent, tasks, currentDate, today)

        if (inCurrentMonth) {
          cell.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.task')) return
            if ((e.target as HTMLElement).closest('.cellName')) return
            this.callbacks.onCellClick(currentDate)
          })
        }
      }

      starts += 7
    }
  }

  private renderTasksForDate(
    container: HTMLElement,
    tasks: Task[],
    date: string,
    today: string,
  ): void {
    const groups = getTasksForDate(tasks, date, today)

    const show = (group: Task[], cls: string) => {
      for (const t of sortTasks(group)) {
        container.appendChild(createTaskCard(t, cls, { onToggle: this.callbacks.onToggle }))
      }
    }

    if (date === today) show(groups.overdue, 'overdue')
    show(groups.due, 'due')
    show(groups.recurrence, 'recurrence')
    show(groups.start, 'start')
    show(groups.scheduled, 'scheduled')
    show(groups.process, 'process')
    show(groups.dailyNote, 'dailyNote')
    show(groups.allDone, 'done')
    show(groups.cancelled, 'cancelled')
  }

  destroy(): void {
    this.containerEl = null
  }
}
