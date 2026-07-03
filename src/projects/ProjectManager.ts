import { normalizePath, TFile, type App } from 'obsidian';
import type { DailyNoteResolver } from '../resolvers/DailyNoteResolver';
import type { CalendarSettings, ProjectStatus } from '../settings/types';

function toStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((t) => String(t));
  if (typeof raw === 'string') return [raw];
  return [];
}

/**
 * Creates project notes and writes their status markers. Status is stored
 * either as a frontmatter property or as a tag, depending on each status's
 * `match.kind`; changing a status clears the markers of sibling defined
 * statuses so a note carries at most one plugin-managed status.
 */
export class ProjectManager {
  constructor(
    private app: App,
    private settings: CalendarSettings,
    private resolver: DailyNoteResolver,
  ) {}

  async setStatus(path: string, statusId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const statuses = this.settings.projects.statuses;
    const target = statuses.find((s) => s.id === statusId);
    if (!target) return;

    const propStatuses = statuses.filter((s) => s.match.kind === 'property');
    const tagStatuses = statuses.filter((s) => s.match.kind === 'tag');

    // Property markers: clear every defined property-status whose value is set,
    // then apply the target if it is a property status. Unrelated keys untouched.
    if (propStatuses.length > 0 || target.match.kind === 'property') {
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const s of propStatuses) {
          const m = s.match as { property: string; value: string };
          const cur = fm[m.property];
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          const curStr = cur === null || cur === undefined ? '' : String(cur);
          if (curStr === m.value) delete fm[m.property];
        }
        if (target.match.kind === 'property') {
          fm[target.match.property] = target.match.value;
        }
      });
    }

    // Tag markers: strip sibling status tags, add the target tag if tag-kind.
    if (tagStatuses.length > 0 || target.match.kind === 'tag') {
      await this.applyTagMarkers(file, target, tagStatuses);
    }
  }

  private async applyTagMarkers(
    file: TFile,
    target: ProjectStatus,
    tagStatuses: ProjectStatus[],
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      let tags = toStringArray(fm['tags']);
      const strip = new Set(
        tagStatuses.map((s) => (s.match as { tag: string }).tag.replace(/^#/, '').toLowerCase()),
      );
      tags = tags.filter((t) => !strip.has(t.replace(/^#/, '').toLowerCase()));
      if (target.match.kind === 'tag') {
        const want = target.match.tag.replace(/^#/, '');
        if (!tags.some((t) => t.replace(/^#/, '').toLowerCase() === want.toLowerCase())) {
          tags.push(want);
        }
      }
      if (tags.length > 0) fm['tags'] = tags;
      else delete fm['tags'];
    });
  }

  async create(name: string): Promise<TFile | null> {
    const folder = this.settings.projects.createFolder.trim();
    const clean = name.trim().replace(/[\\/:*?"<>|]/g, '-');
    if (!clean) return null;
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      try {
        await this.app.vault.createFolder(folder);
      } catch {
        /* already exists — benign race */
      }
    }
    const base = folder ? `${folder}/${clean}` : clean;
    let path = normalizePath(`${base}.md`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${base} ${n}.md`);
      n++;
    }
    const file = await this.resolver.createNoteFromTemplate(
      path,
      this.settings.projects.templatePath,
      clean,
    );
    const defaultId =
      this.settings.projects.defaultStatusId || this.settings.projects.statuses[0]?.id;
    if (defaultId) await this.setStatus(file.path, defaultId);
    await this.app.workspace.getLeaf(false).openFile(file);
    return file;
  }
}
