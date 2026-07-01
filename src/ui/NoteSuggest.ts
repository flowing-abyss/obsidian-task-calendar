import { AbstractInputSuggest, type App, TFile } from 'obsidian';

interface VaultWithConfig {
  getConfig(key: string): unknown;
}

/**
 * Autocomplete for a vault note over a text input. Suggests markdown files,
 * honouring Obsidian's "Excluded files" setting (`userIgnoreFilters`), and
 * reports the picked file back to the caller.
 */
export class NoteSuggest extends AbstractInputSuggest<TFile> {
  constructor(
    app: App,
    private readonly inputElement: HTMLInputElement,
    private readonly onPick: (file: TFile) => void,
  ) {
    super(app, inputElement);
  }

  private ignoreFilters(): string[] {
    const raw = (this.app.vault as unknown as VaultWithConfig).getConfig('userIgnoreFilters');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  }

  /** Mirrors Obsidian's Excluded-files matching: `/regex/` entries or folder-path prefixes. */
  private isIgnored(path: string): boolean {
    for (const filter of this.ignoreFilters()) {
      if (filter.length > 2 && filter.startsWith('/') && filter.endsWith('/')) {
        try {
          if (new RegExp(filter.slice(1, -1)).test(path)) return true;
        } catch {
          // Ignore a malformed regex filter rather than breaking the whole suggester.
        }
      } else {
        const prefix = filter.endsWith('/') ? filter : `${filter}/`;
        if (path === filter || path.toLowerCase().startsWith(prefix.toLowerCase())) return true;
      }
    }
    return false;
  }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase();
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => !this.isIgnored(file.path))
      .filter(
        (file) =>
          !q || file.basename.toLowerCase().includes(q) || file.path.toLowerCase().includes(q),
      )
      .sort((a, b) => a.basename.localeCompare(b.basename))
      .slice(0, 50);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createDiv({ cls: 'tc-suggest-title', text: file.basename });
    const parent = file.parent?.path;
    if (parent && parent !== '/') {
      el.createDiv({ cls: 'tc-suggest-path', text: parent });
    }
  }

  selectSuggestion(file: TFile): void {
    this.onPick(file);
    this.close();
  }
}
