// src/tags/TagManager.ts
import type { App } from 'obsidian';
import { Notice, TFile } from 'obsidian';
import type { Task } from '../parser/types';
import type { CalendarSettings } from '../settings/types';

export class TagManager {
  constructor(
    private app: App,
    private settings: CalendarSettings,
    private saveSettings: () => Promise<void>,
  ) {}

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

  async addTagToTask(task: Task, tag: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existsRe = new RegExp(escaped + '(?![\\w/-])', 'u');
    await this.app.vault.process(file, (content) => {
      const lines = content.split('\n');
      const line = lines[task.line];
      if (!line || existsRe.test(line)) return content;
      lines[task.line] = line.trimEnd() + ' ' + tag;
      return lines.join('\n');
    });
  }

  async removeTagFromTask(task: Task, tag: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\s*' + escaped + '(?![\\w/-])', 'gu');
    await this.app.vault.process(file, (content) => {
      const lines = content.split('\n');
      const line = lines[task.line];
      if (!line) return content;
      lines[task.line] = line.replace(re, '');
      return lines.join('\n');
    });
  }

  async toggleTagOnTask(task: Task, tag: string): Promise<void> {
    if (task.rawText.includes(tag)) {
      await this.removeTagFromTask(task, tag);
    } else {
      await this.addTagToTask(task, tag);
    }
  }

  async replaceTagOnTask(task: Task, oldTag: string, newTag: string): Promise<void> {
    if (oldTag === newTag) return;
    await this.addTagToTask(task, newTag);
    await this.removeTagFromTask(task, oldTag);
  }

  async assignTagFromInbox(task: Task, tag: string): Promise<void> {
    await this.addTagToTask(task, tag);
    if (this.settings.inbox.removeTagOnAssign) {
      const inboxTag = this.settings.inbox.tag;
      if (task.rawText.includes(inboxTag)) {
        await this.removeTagFromTask(task, inboxTag);
      }
    }
  }

  async renameTag(oldTag: string, newTag: string): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    const escaped = oldTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped + '(?![\\w/-])', 'gu');
    let count = 0;
    for (const file of files) {
      const content = await this.app.vault.read(file);
      if (!content.includes(oldTag)) continue;
      const updated = content.replace(re, newTag);
      if (updated !== content) {
        await this.app.vault.modify(file, updated);
        count++;
      }
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
