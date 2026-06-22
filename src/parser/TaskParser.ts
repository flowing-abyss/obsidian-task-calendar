import type { ParseContext, Task, TaskPriority, TaskStatus } from './types'

// Matches task lines: optional indent, "- [char] rest"
const CHECKBOX_RE = /^(\s*)- \[(.)\]\s*(.*)/

const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/u
const SCHEDULED_RE = /⏳\s*(\d{4}-\d{2}-\d{2})/u
const START_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/u
const COMPLETION_RE = /✅\s*(\d{4}-\d{2}-\d{2})/u
const CANCELLED_EMOJI_RE = /❌\s*(\d{4}-\d{2}-\d{2})/u
const TIME_RE = /⏰\s*(\d{1,2}:\d{2})/u
// Recurrence: capture text after 🔁 to end of string (trim in code)
const RECURRENCE_RE = /🔁\s*([\w\s]+)/u

const WIKILINK_ALIAS_RE = /\[\[([^|[\]]+)\|[^[\]]+\]\]/gu
const WIKILINK_RE = /\[\[([^[\]]+)\]\]/gu
const MD_LINK_RE = /\[([^[\]]+)\]\([^)]+\)/gu
const BRACKETS_RE = /\[([^[\]]*)\]/gu
const TAGS_RE = /#[\w/-]+/gu

export function parseTask(rawText: string, ctx: ParseContext): Task | null {
  const match = CHECKBOX_RE.exec(rawText)
  if (!match) return null

  const state = match[2]
  const rest = match[3]
  if (rest === undefined) return null

  let text = rest

  // Status from checkbox char
  let status: TaskStatus
  switch (state) {
    case 'x':
    case 'X': status = 'done'; break
    case '-': status = 'cancelled'; break
    case '/': status = 'in-progress'; break
    default:  status = 'open'
  }

  // Extract and strip emoji metadata
  let due: string | undefined
  let scheduled: string | undefined
  let start: string | undefined
  let completion: string | undefined
  let cancelledDate: string | undefined
  let time: string | undefined
  let recurrence: string | undefined
  let priority: TaskPriority = 'C'

  const dueMatch = DUE_RE.exec(text)
  if (dueMatch) { due = dueMatch[1]; text = text.replace(dueMatch[0], '') }

  const scheduledMatch = SCHEDULED_RE.exec(text)
  if (scheduledMatch) { scheduled = scheduledMatch[1]; text = text.replace(scheduledMatch[0], '') }

  const startMatch = START_RE.exec(text)
  if (startMatch) { start = startMatch[1]; text = text.replace(startMatch[0], '') }

  const completionMatch = COMPLETION_RE.exec(text)
  if (completionMatch) { completion = completionMatch[1]; text = text.replace(completionMatch[0], '') }

  const cancelledMatch = CANCELLED_EMOJI_RE.exec(text)
  if (cancelledMatch) {
    cancelledDate = cancelledMatch[1]
    status = 'cancelled'
    text = text.replace(cancelledMatch[0], '')
  }

  const timeMatch = TIME_RE.exec(text)
  if (timeMatch) { time = timeMatch[1]; text = text.replace(timeMatch[0], '') }

  const recurrenceMatch = RECURRENCE_RE.exec(text)
  if (recurrenceMatch) {
    recurrence = recurrenceMatch[1].trim() || undefined
    text = text.replace(recurrenceMatch[0], '')
  }

  // Priority emoji — check and remove all occurrences
  if (/⏫/u.test(text)) { priority = 'A'; text = text.replace(/⏫/gu, '') }
  else if (/🔼/u.test(text)) { priority = 'B'; text = text.replace(/🔼/gu, '') }
  else if (/🔽/u.test(text)) { priority = 'D'; text = text.replace(/🔽/gu, '') }

  // Collapse links to readable form
  text = text.replace(WIKILINK_ALIAS_RE, '🔗$1')
  text = text.replace(WIKILINK_RE, (_, link: string) => '🔗 ' + link.replace(/\.[^.]*$/u, ''))
  text = text.replace(MD_LINK_RE, '🌐 $1')
  text = text.replace(BRACKETS_RE, '$1')

  // Strip tags
  if (ctx.globalTaskFilter) {
    text = text.split(ctx.globalTaskFilter).join('')
  }
  text = text.replace(TAGS_RE, '').replace(/\s{2,}/gu, ' ').trim()

  // Time prefix for display
  if (time) text = `⏰ ${time} ${text}`.trim()

  return {
    filePath: ctx.filePath,
    line: ctx.line,
    rawText,
    text,
    status,
    due,
    scheduled,
    start,
    completion,
    cancelledDate,
    time,
    recurrence,
    priority,
    dailyNoteDate: ctx.dailyNoteDate,
  }
}
