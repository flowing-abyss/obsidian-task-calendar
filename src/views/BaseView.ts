import type { Task } from '../parser/types'
import type { ResolvedConfig } from '../settings/types'

export abstract class BaseView {
  abstract render(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void

  // Default patch = full re-render. Override in views that need to preserve DOM state.
  patch(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    this.render(container, tasks, config)
  }

  abstract destroy(): void
}
