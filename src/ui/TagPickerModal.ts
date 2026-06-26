import { SuggestModal, type App } from 'obsidian';

export class TagPickerModal extends SuggestModal<string> {
  constructor(
    app: App,
    private getTagColor: (tag: string) => string | undefined,
    private onCommit: (tag: string) => void,
  ) {
    super(app);
    this.setPlaceholder('Type to search tags…');
  }

  getSuggestions(query: string): string[] {
    const rawTags = Object.keys(
      (this.app.metadataCache as unknown as { getTags(): Record<string, number> }).getTags(),
    );
    const tags = rawTags
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .sort((a, b) => {
        const aClean = a.slice(1);
        const bClean = b.slice(1);
        const aRoot = aClean.split('/')[0] ?? '';
        const bRoot = bClean.split('/')[0] ?? '';
        if (aRoot !== bRoot) return aRoot.localeCompare(bRoot);
        return aClean.localeCompare(bClean);
      });
    const q = query.toLowerCase().replace(/^#/, '');
    return q ? tags.filter((t) => t.slice(1).toLowerCase().includes(q)) : tags;
  }

  renderSuggestion(tag: string, el: HTMLElement): void {
    const color = this.getTagColor(tag);
    const span = el.createEl('span', { text: tag, cls: 'tc-tag-suggest-item' });
    if (color) span.setCssProps({ '--tc-tag-suggest-color': color });
  }

  onChooseSuggestion(tag: string): void {
    this.onCommit(tag);
  }
}
