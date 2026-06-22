export function attachLongPress(
  el: HTMLElement,
  onLongPress: (text: string) => void,
  delayMs = 500,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let longFired = false

  const onStart = (e: TouchEvent): void => {
    longFired = false
    const text = (e.currentTarget as HTMLElement).dataset['taskText'] ?? ''
    timer = setTimeout(() => {
      longFired = true
      onLongPress(text)
    }, delayMs)
  }

  const onEnd = (e: TouchEvent): void => {
    if (timer) clearTimeout(timer)
    if (longFired) { e.preventDefault(); e.stopPropagation() }
  }

  const onCancel = (): void => { if (timer) clearTimeout(timer) }
  const onContext = (e: Event): void => { e.preventDefault() }

  el.addEventListener('touchstart', onStart, { passive: true })
  el.addEventListener('touchend', onEnd)
  el.addEventListener('touchmove', onCancel, { passive: true })
  el.addEventListener('touchcancel', onCancel)
  el.addEventListener('contextmenu', onContext)

  el.style.userSelect = 'none'
  el.style.webkitUserSelect = 'none'
  el.style.touchAction = 'manipulation'

  return () => {
    if (timer) clearTimeout(timer)
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchend', onEnd)
    el.removeEventListener('touchmove', onCancel)
    el.removeEventListener('touchcancel', onCancel)
    el.removeEventListener('contextmenu', onContext)
  }
}
