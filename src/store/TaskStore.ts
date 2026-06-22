import { Notice, TFile, type App, type CachedMetadata, type EventRef, type TAbstractFile } from 'obsidian'
import { parseTask } from '../parser/TaskParser'
import type { Task, TaskFilter } from '../parser/types'
import type { CalendarSettings } from '../settings/types'

export interface StoreUpdateEvent {
  changedFile?: string // undefined = bulk init complete
}

type UpdateCallback = (event: StoreUpdateEvent) => void

function momentToRegex(fmt: string): RegExp {
  const escaped = fmt
    .replace(/\./g, '\\.')
    .replace(/,/g, '\\,')
    .replace(/-/g, '\\-')
    .replace(/:/g, '\\:')
    .replace(/ /g, '\\s')
    .replace('dddd', '\\w{4,}')
    .replace('ddd', '\\w{1,3}')
    .replace('dd', '\\w{2}')
    .replace('YYYY', '\\d{4}')
    .replace('YY', '\\d{2}')
    .replace('MMMM', '\\w{4,}')
    .replace('MMM', '\\w{3}')
    .replace('MM', '\\d{2}')
    .replace('DD', '\\d{2}')
    .replace('D', '\\d{1,2}')
    .replace('ww', '\\d{1,2}')
  return new RegExp(`^(${escaped})$`)
}

export class TaskStore {
  private taskMap = new Map<string, Task[]>()
  private frontmatterMap = new Map<string, { color?: string; textColor?: string; icon?: string }>()
  private listeners: UpdateCallback[] = []
  private metadataCacheRefs: EventRef[] = []
  private vaultRefs: EventRef[] = []

  constructor(
    private app: App,
    private settings: CalendarSettings,
  ) {}

  async initialize(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles()
    const CHUNK_SIZE = 50
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE)
      await Promise.all(chunk.map(f => this.loadFile(f)))
      // Yield to event loop between chunks
      await new Promise<void>(resolve => { setTimeout(resolve, 0) })
    }
    this.notify({ changedFile: undefined })
    this.registerEvents()
  }

  private async loadFile(file: TFile): Promise<void> {
    try {
      const cache = this.app.metadataCache.getFileCache(file)
      if (!cache?.listItems?.some(item => item.task !== undefined)) return
      const content = await this.app.vault.cachedRead(file)
      const fm = cache.frontmatter as Record<string, unknown> | undefined
      if (fm) {
        this.frontmatterMap.set(file.path, {
          color: typeof fm['color'] === 'string' ? fm['color'] : undefined,
          textColor: typeof fm['textColor'] === 'string' ? fm['textColor'] : undefined,
          icon: typeof fm['icon'] === 'string' ? fm['icon'] : undefined,
        })
      }
      this.parseFileTasks(file.path, content, cache)
    } catch {
      // File may have been deleted; skip silently
    }
  }

  private parseFileTasks(filePath: string, content: string, cache: CachedMetadata): void {
    if (!cache.listItems) { this.taskMap.delete(filePath); return }
    const lines = content.split('\n')
    const dailyNoteFormat = this.settings.desktop.dailyNoteFormat
    const dailyNoteRegex = momentToRegex(dailyNoteFormat)
    const filename = filePath.replace(/^.*\//, '').replace(/\.[^.]*$/, '')
    const dailyNoteDate = dailyNoteRegex.test(filename)
      ? window.moment(filename, dailyNoteFormat).format('YYYY-MM-DD')
      : undefined

    const tasks: Task[] = []
    const fm = this.frontmatterMap.get(filePath)
    for (const item of cache.listItems) {
      if (item.task === undefined) continue
      const lineIdx = item.position.start.line
      const rawText = lines[lineIdx] ?? ''
      const task = parseTask(rawText, {
        filePath,
        line: lineIdx,
        dailyNoteDate,
        globalTaskFilter: this.settings.desktop.globalTaskFilter || undefined,
      })
      if (task) {
        task.noteColor = fm?.color
        task.noteTextColor = fm?.textColor
        task.noteIcon = fm?.icon
        tasks.push(task)
      }
    }
    if (tasks.length > 0) {
      this.taskMap.set(filePath, tasks)
    } else {
      this.taskMap.delete(filePath)
    }
  }

  private registerEvents(): void {
    const onChanged = this.app.metadataCache.on(
      'changed',
      (file: TFile, data: string, cache: CachedMetadata) => {
        if (file.extension !== 'md') return
        const fm = cache.frontmatter as Record<string, unknown> | undefined
        if (fm) {
          this.frontmatterMap.set(file.path, {
            color: typeof fm['color'] === 'string' ? fm['color'] : undefined,
            textColor: typeof fm['textColor'] === 'string' ? fm['textColor'] : undefined,
            icon: typeof fm['icon'] === 'string' ? fm['icon'] : undefined,
          })
        }
        this.parseFileTasks(file.path, data, cache)
        this.notify({ changedFile: file.path })
      },
    )
    this.metadataCacheRefs.push(onChanged)

    const onRename = this.app.vault.on(
      'rename',
      (file: TAbstractFile, oldPath: string) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return
        const tasks = this.taskMap.get(oldPath)
        if (tasks) {
          const updated = tasks.map(t => ({ ...t, filePath: file.path }))
          this.taskMap.delete(oldPath)
          this.taskMap.set(file.path, updated)
        }
        const fm = this.frontmatterMap.get(oldPath)
        if (fm) { this.frontmatterMap.delete(oldPath); this.frontmatterMap.set(file.path, fm) }
        this.notify({ changedFile: file.path })
      },
    )
    this.vaultRefs.push(onRename)

    const onDelete = this.app.vault.on(
      'delete',
      (file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return
        if (this.taskMap.delete(file.path)) {
          this.frontmatterMap.delete(file.path)
          this.notify({ changedFile: file.path })
        }
      },
    )
    this.vaultRefs.push(onDelete)
  }

  getTasks(filter?: TaskFilter): Task[] {
    let all = Array.from(this.taskMap.values()).flat()
    if (!filter) return all
    if (filter.filePath) all = all.filter(t => t.filePath === filter.filePath)
    if (filter.folder) all = all.filter(t => t.filePath.startsWith(filter.folder!))
    if (filter.tag) all = all.filter(t => t.rawText.includes(filter.tag!))
    if (filter.status?.length) all = all.filter(t => filter.status!.includes(t.status))
    if (filter.dateRange) {
      const { from, to } = filter.dateRange
      all = all.filter(t => {
        const date = t.due ?? t.scheduled ?? t.start ?? t.dailyNoteDate
        return date ? date >= from && date <= to : false
      })
    }
    return all
  }

  async toggleTask(task: Task): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath)
    if (!(file instanceof TFile)) { new Notice('File not found: ' + task.filePath); return }
    const today = window.moment().format('YYYY-MM-DD')
    try {
      await this.app.vault.process(file, (data) => {
        const lines = data.split('\n')
        const line = lines[task.line]
        if (!line) return data
        const isNowChecked = /^(\s*)- \[ \]/.test(line)
        if (isNowChecked) {
          lines[task.line] = line
            .replace(/^(\s*)- \[ \]/, '$1- [x]')
            .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '')
            .trimEnd() + ` ✅ ${today}`
        } else {
          lines[task.line] = line
            .replace(/^(\s*)- \[.\]/, '$1- [ ]')
            .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '')
            .trimEnd()
        }
        return lines.join('\n')
      })
    } catch {
      new Notice('Failed to update task. Please try again.')
    }
  }

  async addTask(date: string, text: string): Promise<void> {
    const s = this.settings
    const prefix = s.taskPrefix.trim()
    const taskLine = `- [ ] ${prefix ? prefix + ' ' : ''}${text} 📅 ${date}`
    let file: TFile | null = null

    if (s.addToToday) {
      // Try periodic-notes plugin settings first
      const appAsAny = this.app as unknown as Record<string, unknown>
      const plugins = appAsAny['plugins'] as Record<string, unknown> | undefined
      const periodicNotes = plugins?.['periodic-notes'] as { settings?: { daily?: { folder?: string; format?: string } } } | undefined
      const folder = periodicNotes?.settings?.daily?.folder ?? s.desktop.dailyNoteFolder
      const format = periodicNotes?.settings?.daily?.format ?? s.desktop.dailyNoteFormat
      const fileName = window.moment().format(format)
      const filePath = `${folder}/${fileName}.md`
      const existing = this.app.vault.getAbstractFileByPath(filePath)
      if (existing instanceof TFile) {
        file = existing
      } else {
        // Open daily note via periodic-notes command, wait for it to appear
        ;(this.app as unknown as { commands: { executeCommandById(id: string): void } })
          .commands.executeCommandById('periodic-notes:open-daily-note')
        for (let tries = 0; tries < 10; tries++) {
          await new Promise<void>(resolve => { setTimeout(resolve, 200) })
          const found = this.app.vault.getAbstractFileByPath(filePath)
          if (found instanceof TFile) { file = found; break }
        }
      }
    } else if (s.customFilePath) {
      const existing = this.app.vault.getAbstractFileByPath(s.customFilePath)
      if (existing instanceof TFile) {
        file = existing
      } else {
        await this.app.vault.create(s.customFilePath, '')
        const found = this.app.vault.getAbstractFileByPath(s.customFilePath)
        if (found instanceof TFile) file = found
      }
    }

    if (!file) { new Notice('No target file found for task.'); return }
    await this.app.vault.process(file, data => data + '\n' + taskLine)
    new Notice('Task added to ' + file.name)
  }

  onUpdate(callback: UpdateCallback): () => void {
    this.listeners.push(callback)
    return () => { this.listeners = this.listeners.filter(l => l !== callback) }
  }

  private notify(event: StoreUpdateEvent): void {
    for (const cb of this.listeners) cb(event)
  }

  destroy(): void {
    for (const ref of this.metadataCacheRefs) this.app.metadataCache.offref(ref)
    for (const ref of this.vaultRefs) this.app.vault.offref(ref)
    this.metadataCacheRefs = []
    this.vaultRefs = []
    this.listeners = []
    this.taskMap.clear()
    this.frontmatterMap.clear()
  }
}
