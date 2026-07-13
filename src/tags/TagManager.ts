// src/tags/TagManager.ts
import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import { locatorOf, TaskMutationService } from '../mutation';
import type { Task } from '../parser/types';
import { toStatusRules } from '../settings/statusCatalogAdapter';
import type { CalendarSettings } from '../settings/types';
import { StatusCatalog } from '../tasks/domain/StatusCatalog';

export class TagManager {
  private mutations: TaskMutationService;

  constructor(
    private app: App,
    private settings: CalendarSettings,
    private saveSettings: () => Promise<void>,
  ) {
    this.mutations = new TaskMutationService(
      app,
      undefined,
      () => new StatusCatalog(toStatusRules(this.settings.taskStatuses)),
    );
  }

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

  async addTagToTask(task: Task, tag: string): Promise<void> {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existsRe = new RegExp(escaped + '(?![\\w/-])', 'u');
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line || existsRe.test(line)) return;
      lines[taskLine] = line.trimEnd() + ' ' + tag;
    });
  }

  async removeTagFromTask(task: Task, tag: string): Promise<void> {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\s*' + escaped + '(?![\\w/-])', 'gu');
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      lines[taskLine] = line.replace(re, '');
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
    // Atomic: add new and remove old in one vault.process to avoid stale-rawText issues.
    const escapedOld = oldTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedNew = newTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const removeRe = new RegExp('\\s*' + escapedOld + '(?![\\w/-])', 'gu');
    const existsRe = new RegExp(escapedNew + '(?![\\w/-])', 'u');
    await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
      const line = lines[taskLine];
      if (!line) return;
      let updated = line.replace(removeRe, '');
      if (!existsRe.test(updated)) updated = updated.trimEnd() + ' ' + newTag;
      lines[taskLine] = updated;
    });
  }

  async assignTagFromInbox(task: Task, tag: string): Promise<void> {
    const inboxTag = this.settings.inbox.tag;
    const shouldRemoveInbox =
      this.settings.inbox.removeTagOnAssign && task.rawText.includes(inboxTag);

    if (shouldRemoveInbox) {
      // Atomic: add new tag and remove inbox tag in a single vault.process.
      const escapedInbox = inboxTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const removeRe = new RegExp('\\s*' + escapedInbox + '(?![\\w/-])', 'gu');
      const escapedNew = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existsRe = new RegExp(escapedNew + '(?![\\w/-])', 'u');
      await this.mutations.applyToLines(locatorOf(task), (lines, taskLine) => {
        const line = lines[taskLine];
        if (!line) return;
        let updated = line.replace(removeRe, '');
        if (!existsRe.test(updated)) updated = updated.trimEnd() + ' ' + tag;
        lines[taskLine] = updated;
      });
    } else {
      await this.addTagToTask(task, tag);
    }
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
