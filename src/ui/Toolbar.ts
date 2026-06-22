const ARROW_LEFT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>`
const ARROW_RIGHT = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`
const FILTER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`
const MONTH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path></svg>`
const WEEK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M17 14h-6"></path><path d="M13 18H7"></path><path d="M7 14h.01"></path><path d="M17 18h.01"></path></svg>`
const LIST_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`

const DEFAULT_VIEW_ICONS: Record<string, string> = {
  month: MONTH_ICON,
  week: WEEK_ICON,
  list: LIST_ICON,
}

export interface ViewEntry {
  id: string
  icon: string
  label: string
}

export interface ToolbarState {
  currentView: string
  currentTitle: string
  filterActive: boolean
  overdueHighlightActive: boolean
  stats: {
    done: number
    due: number
    overdue: number
    start: number
    scheduled: number
    recurrence: number
    dailyNote: number
  }
  activeStatGroup: string | null
}

export interface ToolbarCallbacks {
  onPrev(): void
  onNext(): void
  onToday(): void
  onViewSwitch(viewId: string): void
  onFilterToggle(): void
  onOverdueHighlight(): void
  onStatFilter(group: string | null): void
}

export class Toolbar {
  private el: HTMLElement
  private currentBtn: HTMLButtonElement
  private viewButtons = new Map<string, HTMLButtonElement>()
  private filterBtn: HTMLButtonElement
  private overdueBtn: HTMLButtonElement
  private statBtn: HTMLButtonElement
  private statPopup: HTMLElement
  private statEls: Record<string, HTMLElement> = {}
  private activeCloseHandler: ((e: MouseEvent) => void) | null = null

  constructor(
    container: HTMLElement,
    views: ViewEntry[],
    callbacks: ToolbarCallbacks,
  ) {
    this.el = container.createDiv('buttons')
    this.filterBtn = this.makeBtn('filter', FILTER_ICON, '', () => callbacks.onFilterToggle())
    for (const v of views) {
      const icon = DEFAULT_VIEW_ICONS[v.id] ?? v.icon
      const btn = this.makeBtn(v.id + 'View', icon, v.label, () => callbacks.onViewSwitch(v.id))
      this.viewButtons.set(v.id, btn)
    }
    this.currentBtn = this.makeBtn('current', '', '', () => callbacks.onToday())
    this.makeBtn('previous', ARROW_LEFT, '', () => callbacks.onPrev())
    this.makeBtn('next', ARROW_RIGHT, '', () => callbacks.onNext())
    this.overdueBtn = this.makeBtn('overdueHighlighter', '⚠️', 'Highlight overdue', () => {
      callbacks.onOverdueHighlight()
    })
    this.statBtn = this.makeBtn('statistic', '📊', '', () => this.toggleStatPopup())
    this.statBtn.setAttribute('percentage', '')

    // Statistics popup
    this.statPopup = this.el.createEl('ul', { cls: 'statisticPopup' })
    const statDefs: Array<[string, string, string]> = [
      ['done', '✅', 'Done'],
      ['due', '📅', 'Due'],
      ['start', '🛫', 'Start'],
      ['scheduled', '⏳', 'Scheduled'],
      ['recurrence', '🔁', 'Recurring'],
      ['dailyNote', '📄', 'Daily'],
    ]
    for (const [group, icon, label] of statDefs) {
      const li = this.statPopup.createEl('li', { attr: { 'data-group': group } })
      li.createEl('span', { cls: 'stat-label', text: label })
      const countSpanEl = li.createEl('span', { cls: 'stat-count', text: '0' })
      const iconSpan = document.createElement('span')
      iconSpan.textContent = icon + ' '
      li.prepend(iconSpan)
      this.statEls[group] = countSpanEl
      li.addEventListener('click', () => {
        const isActive = li.classList.contains('active')
        this.statPopup.querySelectorAll('li').forEach(el => el.classList.remove('active'))
        if (!isActive) { li.classList.add('active'); callbacks.onStatFilter(group) }
        else { callbacks.onStatFilter(null) }
      })
    }
  }

  private makeBtn(cls: string, icon: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = this.el.createEl('button', { cls })
    if (icon) btn.innerHTML = icon
    if (title) btn.title = title
    btn.addEventListener('click', (e) => { e.preventDefault(); onClick(); btn.blur() })
    return btn
  }

  private toggleStatPopup(): void {
    const isActive = this.statBtn.classList.toggle('active')
    this.statPopup.classList.toggle('active', isActive)
    if (isActive) {
      const closePopup = (e: MouseEvent) => {
        if (!this.statPopup.contains(e.target as Node) && e.target !== this.statBtn) {
          this.statPopup.classList.remove('active')
          this.statBtn.classList.remove('active')
          document.removeEventListener('mousedown', closePopup)
          this.activeCloseHandler = null
        }
      }
      this.activeCloseHandler = closePopup
      setTimeout(() => document.addEventListener('mousedown', closePopup), 0)
    }
  }

  update(state: ToolbarState): void {
    this.currentBtn.textContent = state.currentTitle
    this.filterBtn.classList.toggle('active', state.filterActive)
    this.overdueBtn.classList.toggle('active', state.overdueHighlightActive)
    for (const [id, btn] of this.viewButtons) {
      btn.classList.toggle('active', id === state.currentView)
    }
    if (this.statEls['done']) this.statEls['done'].textContent = String(state.stats.done)
    if (this.statEls['due']) this.statEls['due'].textContent = String(state.stats.due)
    if (this.statEls['start']) this.statEls['start'].textContent = String(state.stats.start)
    if (this.statEls['scheduled']) this.statEls['scheduled'].textContent = String(state.stats.scheduled)
    if (this.statEls['recurrence']) this.statEls['recurrence'].textContent = String(state.stats.recurrence)
    if (this.statEls['dailyNote']) this.statEls['dailyNote'].textContent = String(state.stats.dailyNote)

    // Reconcile active stat group highlight
    this.statPopup.querySelectorAll('li').forEach(li => li.classList.remove('active'))
    if (state.activeStatGroup !== null) {
      const activeLi = this.statPopup.querySelector(`li[data-group="${state.activeStatGroup}"]`)
      activeLi?.classList.add('active')
    }
  }

  destroy(): void {
    if (this.activeCloseHandler !== null) {
      document.removeEventListener('mousedown', this.activeCloseHandler)
      this.activeCloseHandler = null
    }
    this.el.remove()
  }
}
