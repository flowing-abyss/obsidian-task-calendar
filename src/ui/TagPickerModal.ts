import { Modal, setIcon, type App } from 'obsidian';

type TagState = 'checked' | 'partial' | 'unchecked';

export class TagPickerModal extends Modal {
  private readonly pending = new Map<string, boolean>(); // true=add, false=remove
  private searchEl!: HTMLInputElement;
  private listEl!: HTMLElement;
  private allTags: string[] = [];

  constructor(
    app: App,
    private readonly getTagColor: (tag: string) => string | undefined,
    private readonly currentTags: Set<string>,  // tags ALL tasks have
    private readonly partialTags: Set<string>,  // tags SOME tasks have (bulk only)
    private readonly onCommit: (toAdd: string[], toRemove: string[]) => void,
  ) {
    super(app);
    this.modalEl.addClass('tc-tag-picker-modal');
    this.setTitle('Select tags');
  }

  onOpen(): void {
    const rawTags = Object.keys(
      (this.app.metadataCache as unknown as { getTags(): Record<string, number> }).getTags(),
    );
    this.allTags = rawTags
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .sort((a, b) => {
        const [ac, bc] = [a.slice(1), b.slice(1)];
        const [ar, br] = [ac.split('/')[0] ?? '', bc.split('/')[0] ?? ''];
        if (ar !== br) return ar.localeCompare(br);
        return ac.localeCompare(bc);
      });

    const { contentEl } = this;
    contentEl.empty();

    this.searchEl = contentEl.createEl('input', {
      cls: 'tc-tag-picker-search',
      attr: { type: 'text', placeholder: 'Search tags…' },
    });
    this.searchEl.addEventListener('input', () => this.renderList(this.searchEl.value));

    this.listEl = contentEl.createDiv({ cls: 'tc-tag-picker-list' });
    this.renderList('');
    window.setTimeout(() => this.searchEl.focus(), 10);
  }

  private effectiveState(tag: string): TagState {
    if (this.pending.has(tag)) return this.pending.get(tag) ? 'checked' : 'unchecked';
    if (this.currentTags.has(tag)) return 'checked';
    if (this.partialTags.has(tag)) return 'partial';
    return 'unchecked';
  }

  private toggle(tag: string): void {
    const state = this.effectiveState(tag);
    if (state === 'checked') {
      if (this.currentTags.has(tag)) {
        this.pending.set(tag, false); // will remove
      } else {
        this.pending.delete(tag); // undo pending add
      }
    } else {
      if (this.pending.get(tag) === false) {
        this.pending.delete(tag); // undo pending remove
      } else {
        this.pending.set(tag, true); // will add
      }
    }
    this.renderList(this.searchEl.value);
  }

  private renderList(query: string): void {
    this.listEl.empty();
    const q = query.toLowerCase().replace(/^#/, '');
    const filtered = q
      ? this.allTags.filter((t) => t.slice(1).toLowerCase().includes(q))
      : this.allTags;

    for (const tag of filtered) {
      this.renderItem(tag);
    }

    if (filtered.length === 0) {
      this.listEl.createDiv({ cls: 'tc-tag-picker-empty', text: 'No tags found' });
    }
  }

  private renderItem(tag: string): void {
    const state = this.effectiveState(tag);
    const item = this.listEl.createDiv({ cls: `tc-tag-picker-item tc-tag-picker-item--${state}` });

    const iconEl = item.createSpan({ cls: 'tc-tag-picker-icon' });
    if (state === 'checked') setIcon(iconEl, 'check');
    else if (state === 'partial') setIcon(iconEl, 'minus');

    const labelEl = item.createSpan({ cls: 'tc-tag-picker-label', text: tag });
    const color = this.getTagColor(tag);
    if (color) labelEl.setCssProps({ '--tc-tag-picker-color': color });

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.toggle(tag);
    });
  }

  onClose(): void {
    const toAdd = [...this.pending.entries()].filter(([, v]) => v).map(([k]) => k);
    const toRemove = [...this.pending.entries()].filter(([, v]) => !v).map(([k]) => k);
    if (toAdd.length > 0 || toRemove.length > 0) this.onCommit(toAdd, toRemove);
    this.contentEl.empty();
  }
}
