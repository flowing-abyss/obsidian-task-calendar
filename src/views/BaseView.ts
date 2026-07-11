import type { Task } from '../parser/types';
import type { ResolvedConfig } from '../settings/types';

export abstract class BaseView {
  /**
   * `shouldScrollToNow` (Task 27): TodayView/WeekTimeGridView use this to decide whether to run
   * their one-time scroll-to-now on this render. It defaults to true so every other caller
   * (tests, BaseView.patch below, views that don't have a now-line at all) keeps prior behavior
   * unchanged; only CenterPanel — which owns the (calViewType, calDate) key that survives its
   * mountView() destroy/recreate cycle — ever passes `false`, and only for a reactive re-render
   * of a view/date it has already scrolled for.
   */
  abstract render(
    container: HTMLElement,
    tasks: Task[],
    config: ResolvedConfig,
    shouldScrollToNow?: boolean,
  ): void;

  // Default patch = full re-render. Override in views that need to preserve DOM state.
  patch(container: HTMLElement, tasks: Task[], config: ResolvedConfig): void {
    this.render(container, tasks, config);
  }

  abstract destroy(): void;
}
