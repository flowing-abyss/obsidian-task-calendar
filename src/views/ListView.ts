import type { Task } from '../parser/types'
import type { ResolvedConfig } from '../settings/types'
import { createTaskCard } from '../ui/TaskCard'
import { BaseView } from './BaseView'
import { getTasksForDate, renderTaskGroup } from './taskGrouping'

export interface ListViewCallbacks {
  onToggle: (task: Task) => void
  onDateClick: (date: string) => void
}

export class ListView extends BaseView {
  private containerEl: HTMLElement | null = null

  constructor(private callbacks: ListViewCallbacks) {
    super()
  }

  render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    this.containerEl = container
    container.empty()

    const today = window.moment().format('YYYY-MM-DD')
    const month = config.startPosition
      ? window.moment(config.startPosition, 'YYYY-MM').date(1)
      : window.moment().date(1)

    const grid = container.createDiv('grid')

    for (let i = 1; i <= 31; i++) {
      const currentDate = window.moment(month).date(i).format('YYYY-MM-DD')
      if (window.moment(currentDate).month() !== window.moment(month).month()) break

      const groups = getTasksForDate(tasks, currentDate, today)
      const hasContent = Object.values(groups).some((g) => g.length > 0)
      if (!hasContent) continue

      const listItem = grid.createDiv('listItem')
      const dateSpan = listItem.createEl('span', { cls: 'listDate', text: currentDate })
      const listContent = listItem.createDiv('listContent')

      renderTaskGroup(listContent, groups, currentDate, today, (task, cls) =>
        createTaskCard(task, cls, { onToggle: this.callbacks.onToggle }),
      )

      dateSpan.addEventListener('click', () => this.callbacks.onDateClick(currentDate))
    }
  }

  destroy(): void {
    this.containerEl = null
  }
}
