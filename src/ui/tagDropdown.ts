import type { App } from 'obsidian';

export function showTagDropdown(
  container: HTMLElement,
  app: App,
  getTagColor: (tag: string) => string | undefined,
  onCommit: (tag: string) => void,
  onClose?: () => void,
  position?: { x: number; y: number },
): void {
  // Remove any existing dropdown (in container or floating)
  container.querySelector('.tc-tag-dropdown-wrap')?.remove();
  activeDocument.querySelector('.tc-tag-dropdown-wrap--floating')?.remove();

  const rawTags = Object.keys(
    (app.metadataCache as unknown as { getTags(): Record<string, number> }).getTags(),
  );
  const sortedTags = rawTags
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .sort((a, b) => {
      const aClean = a.slice(1);
      const bClean = b.slice(1);
      const aRoot = aClean.split('/')[0] ?? '';
      const bRoot = bClean.split('/')[0] ?? '';
      if (aRoot !== bRoot) return aRoot.localeCompare(bRoot);
      const da = (aClean.match(/\//g) ?? []).length;
      const db = (bClean.match(/\//g) ?? []).length;
      if (da !== db) return da - db;
      return aClean.localeCompare(bClean);
    });

  const mountPoint = position ? activeDocument.body : container;
  const wrapCls = position ? 'tc-tag-dropdown-wrap tc-tag-dropdown-wrap--floating' : 'tc-tag-dropdown-wrap';
  const wrap = mountPoint.createDiv({ cls: wrapCls });
  if (position) {
    wrap.style.left = `${position.x}px`;
    wrap.style.top = `${position.y}px`;
  }
  const input = wrap.createEl('input', {
    cls: 'tc-tag-input',
    attr: { type: 'text', placeholder: '#Tag', autocomplete: 'off' },
  });
  const dropdown = wrap.createDiv({ cls: 'tc-tag-dropdown' });
  let activeIdx = -1;

  const close = (): void => {
    wrap.remove();
    onClose?.();
  };

  const commit = (value: string): void => {
    const v = value.trim();
    if (v) onCommit(v);
    close();
  };

  const renderOptions = (query: string): void => {
    dropdown.empty();
    activeIdx = -1;
    const q = query.toLowerCase().replace(/^#/, '');
    const filtered = q
      ? sortedTags.filter((t) => t.slice(1).toLowerCase().includes(q))
      : sortedTags;
    if (filtered.length === 0) {
      dropdown.addClass('tc-tag-dropdown--hidden');
      return;
    }
    dropdown.removeClass('tc-tag-dropdown--hidden');
    for (const tag of filtered) {
      const opt = dropdown.createDiv({ cls: 'tc-tag-dropdown-opt', text: tag });
      const color = getTagColor(tag);
      if (color) opt.setCssProps({ '--tc-tag-opt-color': color });
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        commit(tag);
      });
    }
  };

  const updateActive = (delta: number): void => {
    const opts = dropdown.querySelectorAll<HTMLElement>('.tc-tag-dropdown-opt');
    if (opts.length === 0) return;
    opts[activeIdx]?.removeClass('is-active');
    activeIdx = Math.max(0, Math.min(opts.length - 1, activeIdx + delta));
    const next = opts[activeIdx];
    next?.addClass('is-active');
    next?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => renderOptions(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateActive(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateActive(-1);
      return;
    }
    if (e.key === 'Enter') {
      const active = dropdown.querySelector<HTMLElement>('.tc-tag-dropdown-opt.is-active');
      commit(active ? (active.textContent ?? '') : input.value);
      return;
    }
    if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => window.setTimeout(close, 200));

  renderOptions('');
  input.focus();
}
