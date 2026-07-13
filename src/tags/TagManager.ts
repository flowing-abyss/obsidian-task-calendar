// src/tags/TagManager.ts
import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import type { CalendarSettings } from '../settings/types';

export class TagManager {
  constructor(
    private app: App,
    private settings: CalendarSettings,
    private saveSettings: () => Promise<void>,
  ) {}

  /**
   * Zero-friction manual tag: creates a manual TagGroup holding one tag derived
   * from the name. Nested/prefix tags remain a settings-time configuration.
   */
  async createManualGroup(name: string): Promise<void> {
    const label = name.trim();
    if (!label) return;
    const slug = label
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w/-]/g, '');
    if (!slug) return;
    const tag = slug.startsWith('#') ? slug : `#${slug}`;
    // Collision-proof id (length-based ids repeat after add/delete cycles).
    const base = `group-${slug || 'tag'}`;
    let id = base;
    let n = 2;
    while (this.settings.tagGroups.some((g) => g.id === id)) id = `${base}-${n++}`;
    this.settings.tagGroups.push({ id, name: label, mode: 'manual', tags: [tag] });
    await this.saveSettings();
  }

  async pinTag(tag: string): Promise<void> {
    if (this.settings.pinnedTags.includes(tag)) return;
    this.settings.pinnedTags.push(tag);
    await this.saveSettings();
  }

  async unpinTag(tag: string): Promise<void> {
    const idx = this.settings.pinnedTags.indexOf(tag);
    if (idx < 0) return;
    this.settings.pinnedTags.splice(idx, 1);
    await this.saveSettings();
  }

  async archiveTag(tag: string): Promise<void> {
    if (this.settings.archivedTags.includes(tag)) return;
    this.settings.archivedTags.push(tag);
    // also unpin
    const pi = this.settings.pinnedTags.indexOf(tag);
    if (pi >= 0) this.settings.pinnedTags.splice(pi, 1);
    await this.saveSettings();
  }

  async unarchiveTag(tag: string): Promise<void> {
    const idx = this.settings.archivedTags.indexOf(tag);
    if (idx < 0) return;
    this.settings.archivedTags.splice(idx, 1);
    await this.saveSettings();
  }

  async renameTag(oldTag: string, newTag: string): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const escaped = oldTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped + '(?![\\w/-])', 'gu');
    let count = 0;
    for (const file of files) {
      let changed = false;
      await this.app.vault.process(file, (content) => {
        if (!content.includes(oldTag)) return content;
        const updated = content.replace(re, newTag);
        if (updated !== content) changed = true;
        return updated;
      });
      if (changed) count++;
    }
    // Update pinnedTags
    const pi = this.settings.pinnedTags.indexOf(oldTag);
    if (pi >= 0) this.settings.pinnedTags[pi] = newTag;
    // Update archivedTags
    const ai = this.settings.archivedTags.indexOf(oldTag);
    if (ai >= 0) this.settings.archivedTags[ai] = newTag;
    // Update manual tagGroups
    for (const g of this.settings.tagGroups) {
      if (g.mode === 'manual' && g.tags) {
        const ti = g.tags.indexOf(oldTag);
        if (ti >= 0) g.tags[ti] = newTag;
      }
    }
    await this.saveSettings();
    new Notice(`Renamed ${oldTag} → ${newTag} in ${count} file${count !== 1 ? 's' : ''}`);
  }
}
