import { Notice, TFile, normalizePath, type App } from 'obsidian';
import type { CalendarSettings } from '../settings/types';
import { CoreDailyNotesAdapter } from './adapters/CoreDailyNotesAdapter';
import { JournalAdapter } from './adapters/JournalAdapter';
import { ManualAdapter } from './adapters/ManualAdapter';
import { PeriodicNotesAdapter } from './adapters/PeriodicNotesAdapter';
import type { DailyNoteAdapter, DailyNoteProviderSettings, ProviderId } from './types';

const ADAPTER_CHAIN: DailyNoteAdapter[] = [
  new PeriodicNotesAdapter(),
  new JournalAdapter(),
  new CoreDailyNotesAdapter(),
  new ManualAdapter(),
];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  'periodic-notes': 'Periodic Notes',
  core: 'Core Daily Notes',
  'obsidian-journal': 'Obsidian Journal',
  manual: 'Manual',
};

export class DailyNoteResolver {
  constructor(
    private app: App,
    private settings: CalendarSettings,
  ) {}

  getActiveAdapter(): DailyNoteAdapter {
    const { dailyNoteProvider } = this.settings;
    if (dailyNoteProvider === 'auto') {
      return (
        ADAPTER_CHAIN.find((a) => a.isAvailable(this.app)) ??
        ADAPTER_CHAIN[ADAPTER_CHAIN.length - 1]!
      );
    }
    const match = ADAPTER_CHAIN.find((a) => a.id === dailyNoteProvider);
    return match?.isAvailable(this.app) ? match : ADAPTER_CHAIN[ADAPTER_CHAIN.length - 1]!;
  }

  getAvailableProviders(): Array<{ id: ProviderId | 'auto'; label: string }> {
    const result: Array<{ id: ProviderId | 'auto'; label: string }> = [
      { id: 'auto', label: this.autoLabel() },
    ];
    for (const a of ADAPTER_CHAIN) {
      if (a.isAvailable(this.app)) {
        result.push({ id: a.id, label: PROVIDER_LABELS[a.id] });
      }
    }
    return result;
  }

  buildTaskLine(text: string, date: string): string {
    const prefix = this.settings.taskPrefix.trim();
    return `- [ ] ${prefix ? prefix + ' ' : ''}${text} 📅 ${date}`;
  }

  async addTask(text: string, date: string): Promise<void> {
    return this.appendLine(this.buildTaskLine(text, date));
  }

  async appendLine(rawLine: string): Promise<void> {
    const adapter = this.getActiveAdapter();
    const ps = adapter.getSettings(this.app, this.settings);
    let file: TFile;
    try {
      file = await this.ensureNote(ps);
    } catch (e) {
      new Notice('Failed to get or create daily note: ' + String(e));
      return;
    }
    try {
      await this.insertTask(file, rawLine);
    } catch (e) {
      new Notice('Failed to insert task: ' + String(e));
      return;
    }
    new Notice('Task added to ' + file.name);
  }

  private async ensureNote(ps: DailyNoteProviderSettings): Promise<TFile> {
    const fileName = window.moment().format(ps.format);
    const filePath = normalizePath(ps.folder ? `${ps.folder}/${fileName}.md` : `${fileName}.md`);
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) return existing;

    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
    if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }

    return this.createNoteWithTemplate(filePath, ps.template, fileName);
  }

  /**
   * Public wrapper so other subsystems (e.g. Projects) can create a note from
   * a template using the same Templater-aware path as daily notes.
   */
  async createNoteFromTemplate(
    filePath: string,
    templatePath: string,
    title: string,
  ): Promise<TFile> {
    return this.createNoteWithTemplate(filePath, templatePath, title);
  }

  private async createNoteWithTemplate(
    filePath: string,
    templatePath: string,
    dateTitle: string,
  ): Promise<TFile> {
    const templater = this.getTemplaterPlugin();
    if (templater && templatePath) {
      const newFile = await this.app.vault.create(filePath, '');
      const templateTFile = this.app.metadataCache.getFirstLinkpathDest(templatePath, '');
      if (templateTFile instanceof TFile) {
        await (
          templater as unknown as {
            templater: { write_template_to_file(t: TFile, f: TFile): Promise<void> };
          }
        ).templater.write_template_to_file(templateTFile, newFile);
      }
      return newFile;
    }

    if (templatePath) {
      const content = await this.readRawTemplate(templatePath, dateTitle);
      return this.app.vault.create(filePath, content);
    }

    return this.app.vault.create(filePath, '');
  }

  private async readRawTemplate(templatePath: string, dateTitle: string): Promise<string> {
    const tfile = this.app.metadataCache.getFirstLinkpathDest(templatePath, '');
    if (!(tfile instanceof TFile)) return '';
    const raw = await this.app.vault.cachedRead(tfile);
    const now = window.moment();
    return raw
      .replace(/\{\{\s*date\s*\}\}/gi, dateTitle)
      .replace(/\{\{\s*time\s*\}\}/gi, now.format('HH:mm'))
      .replace(/\{\{\s*title\s*\}\}/gi, dateTitle);
  }

  private getTemplaterPlugin(): unknown {
    try {
      return (
        this.app as unknown as { plugins: { getPlugin(id: string): unknown } }
      ).plugins.getPlugin('templater-obsidian');
    } catch {
      return null;
    }
  }

  private async insertTask(file: TFile, line: string): Promise<void> {
    const { taskInsertionMode: mode, taskInsertionSection: section } = this.settings;
    await this.app.vault.process(file, (content) => {
      if (mode === 'section' && section.trim()) {
        const lines = content.split('\n');
        const idx = lines.findIndex((l) => l.trim() === section.trim());
        if (idx === -1) {
          return content.trimEnd() + '\n\n' + section + '\n' + line + '\n';
        }
        lines.splice(idx + 1, 0, line);
        return lines.join('\n');
      }
      return content.trimEnd() + '\n' + line + '\n';
    });
  }

  private autoLabel(): string {
    const detected = ADAPTER_CHAIN.find((a) => a.isAvailable(this.app));
    if (!detected || detected.id === 'manual') return 'Auto-detect';
    return `Auto-detect (${PROVIDER_LABELS[detected.id]} detected)`;
  }
}
