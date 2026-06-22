import { MarkdownRenderChild, Platform, type Plugin } from 'obsidian'
import { CalendarRenderer } from '../ui/CalendarRenderer'
import type { CalendarSettings, CodeBlockParams, ResolvedConfig } from '../settings/types'
import type { TaskStore } from '../store/TaskStore'
import { DEFAULT_VIEW_CONFIG } from '../settings/defaults'

// Note: if 'yaml' is not available as a dependency, use a simple key:value line parser
function parseCodeBlockYaml(source: string): CodeBlockParams {
  try {
    // Use JSON.parse-safe subset: only parse simple key: value lines
    const params: Record<string, unknown> = {}
    for (const line of source.split('\n')) {
      const m = /^(\w+)\s*:\s*(.+)$/.exec(line.trim())
      if (m?.[1] != null && m[2] != null) params[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    // Coerce numeric fields
    if (params['firstDayOfWeek'] !== undefined) params['firstDayOfWeek'] = parseInt(String(params['firstDayOfWeek']))
    if (params['upcomingDays'] !== undefined) params['upcomingDays'] = parseInt(String(params['upcomingDays']))
    return params as CodeBlockParams
  } catch {
    return {}
  }
}

function resolveConfig(settings: CalendarSettings, params: CodeBlockParams): ResolvedConfig {
  const platformConfig = Platform.isMobile ? settings.mobile : settings.desktop
  const merged = { ...DEFAULT_VIEW_CONFIG, ...platformConfig }
  // Apply code block overrides
  if (params.view) merged.defaultView = params.view
  if (params.firstDayOfWeek !== undefined) {
    const fw = Math.min(6, Math.max(0, params.firstDayOfWeek))
    merged.firstDayOfWeek = fw as ResolvedConfig['firstDayOfWeek']
  }
  if (params.dailyNoteFolder) merged.dailyNoteFolder = params.dailyNoteFolder
  if (params.dailyNoteFormat) merged.dailyNoteFormat = params.dailyNoteFormat
  if (params.style) merged.style = params.style
  if (params.globalTaskFilter) merged.globalTaskFilter = params.globalTaskFilter
  if (params.startPosition) merged.startPosition = params.startPosition
  if (params.tag) merged.tag = params.tag
  if (params.folder) merged.folder = params.folder
  return { ...merged, isMobile: Platform.isMobile }
}

export function registerCodeBlock(plugin: Plugin, store: TaskStore, settings: CalendarSettings): void {
  plugin.registerMarkdownCodeBlockProcessor('task-calendar', (source, el, ctx) => {
    let params: CodeBlockParams
    try {
      params = parseCodeBlockYaml(source)
    } catch {
      const err = el.createDiv({ cls: 'callout' })
      err.createEl('p', { text: 'task-calendar: invalid YAML in code block.' })
      return
    }

    const config = resolveConfig(settings, params)
    const tid = String(Date.now())
    const rootEl = el.createDiv({
      cls: `tasksCalendar ${config.style}`,
      attr: {
        id: 'tasksCalendar' + tid,
        view: config.defaultView,
        style: 'position:relative;-webkit-user-select:none!important',
      },
    })

    const renderer = new CalendarRenderer(rootEl, store, config, plugin.app)

    // MarkdownRenderChild ensures cleanup when the block leaves the DOM
    const child = new MarkdownRenderChild(el)
    child.onunload = () => renderer.destroy()
    ctx.addChild(child)

    renderer.mount()
  })
}
