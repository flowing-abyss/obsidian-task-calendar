[Obsidian-Tasks-Calendar](https://github.com/702573N/Obsidian-Tasks-Calendar?tab=readme-ov-file#obsidian-tasks-calendar)

```js
const tasks = dv.pages().file.tasks.where((t) => t.text.includes('📅'));

await window.renderCalendar(dv, {
  tasks,
  view: 'month',
  firstDayOfWeek: '1',
  options: 'style3',
  dailyNoteFolder: 'periodic/daily',
  dailyNoteFormat: 'YYYY-MM-DD',
});
```
