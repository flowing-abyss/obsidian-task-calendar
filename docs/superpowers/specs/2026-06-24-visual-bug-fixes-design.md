# Visual Bug Fixes — Design Spec

**Date:** 2026-06-24  
**Status:** Reviewed & Approved  
**Branch start:** 252fddf

## Список исправлений (13 пунктов)

---

### B1 — Task card: метаданные справа (Todoist-стиль)

**Проблема:** метаданные (теги, дата, прогресс) рендерятся под заголовком задачи.

**Решение:** Перестроить DOM task card в `CenterPanel.renderTaskCard`:
```
<div class="tc-task-card">
  <input checkbox>
  <div class="tc-task-body">        ← flex: 1, min-width: 0
    <div class="tc-task-title-row"> ← time + title
    [description span if exists]
  </div>
  <div class="tc-task-meta-right">  ← flex-shrink: 0, align-items: flex-end
    <div class="tc-task-pills">date | tags | progress</div>
  </div>
  <button class="tc-task-delete-btn">
</div>
```
CSS: `.tc-task-card { display:flex; align-items:flex-start }`. `.tc-task-meta-right { flex-shrink:0; display:flex; align-items:center; gap:6px }`.

---

### B2 — Chip-теги в правой панели

**Проблема:** tag chips выглядят несогласованно — крестик большой, размеры прыгают.

**Решение:** Унифицировать `.tc-chip` и `.tc-chip-tag`. Все chips одинаковой высоты (24px), border-radius 12px, font-size 12px. Кнопка-крестик: 14px, line-height 1, без border.

---

### B3 — Popover времени: позиция

**Проблема:** `showTimePopover` использует `anchor.after(pop)` без `position: absolute`, popover раздвигает контент.

**Решение:** Сделать `.tc-popover` позицией `absolute` относительно ближайшего positioned-предка. В `showTimePopover` вместо `anchor.after(pop)` — вычислять `offsetTop/offsetLeft` якоря относительно `this.el` и устанавливать `pop.style.top/left`. Добавить `position: relative` на `.tc-right`.

---

### B4 — Секции Description/Subtasks/Comments: отступы + Todoist-стиль

**Проблема:** секции слиплись, комментарии требуют кнопку вместо inline-поля.

**Решение:**
- Между секциями `padding-top: 20px`, `border-top: 1px solid var(--background-modifier-border)`.
- Комментарии: убрать кнопку "Add comment" полностью, всегда показывать `<textarea placeholder="Write a comment…">`. При нажатии Enter (без Shift) — сохранить и очистить поле. Shift+Enter — переход строки.
- Sub-tasks: убрать `+ add` кнопку из хедера. Внизу списка подзадач добавить inline-строку `+ Add sub-task` (тонкий текст, клик → input).

---

### B5 — Контекстное меню: toggle + пункты

**Проблема:** повторный клик на `⋯` не закрывает меню. "Copy link" бесполезен.

**Решение:**
- В `renderContextMenu`: перед созданием меню проверять `menuBtn.contains` уже существующее `.tc-context-menu` и закрывать его. Или использовать флаг на элементе.
- Заменить "Copy link" → "Open in file" (открывает файл задачи через `openInFile`).
- Оба пункта меню закрывают меню после выполнения действия.

---

### B6 — Подзадачи: индикаторы вложенных данных

**Проблема:** подзадачи с собственными подзадачами или комментариями не имеют индикаторов.

**Решение:** В `renderSubTask` (RightPanel) добавить мета-строку под label:
- Если `sub.subtasks?.length > 0` → `0/N` прогресс
- Если `sub.comments?.length > 0` → `💬 N`

---

### B7 — Комментарии: динамическое обновление без потери фокуса

**Проблема:** после добавления комментария вся правая панель перерендерится через store.onUpdate, теряя фокус.

**Решение:** Комментарий добавляется оптимистично — сначала `append` в DOM список комментариев (немедленно), потом `vault.process` записывает в файл. Никакого ожидания ответа от store перед обновлением UI. Фокус и позиция скролла не теряются.

---

### B8 — Поиск: клик на задачу открывает контекст

**Проблема:** клик на задачу в поиске ничего не делает (правая панель скрыта в search mode).

**Решение:** В `renderSearch` — при клике на задачу:
1. `state.set('mode', 'tasks')`
2. Определить список по three-way logic: если `due < today` или `due/scheduled/dailyNoteDate === today` → `'today'`; если дата в будущем → `'upcoming'`; иначе → `'inbox'`
3. `state.set('taskStack', [task])` — покажет задачу в правой панели

---

### B9 — Today: просроченные задачи сверху

**Проблема:** `getFilteredTasks('today')` не включает просроченные задачи.

**Решение:** В фильтре 'today' добавить просроченные (`due < today` и `status === 'open'`). В `renderGrouped` убедиться что "Overdue" группа рендерится первой.

---

### B10 — Теги: шеврон ↔ название раздельно

**Проблема:** весь хедер группы — одна зона клика для expand+select.

**Решение:** В `LeftPanel.renderTagGroup`:
- Стрелка `▶`/`▼` — отдельный элемент с `e.stopPropagation()`, кликает только expand/collapse
- Остальная часть (dot + name + count) — кликает только select (без toggle expand)

---

### B11 — Модальное окно: кнопка закрыть + стиль чипов

**Проблема:** close button overlaps с кнопками `↗ ⋯`. Чипы выглядят не как в правой панели.

**Решение:**
- В `TaskModal.open()`: после `innerPanel.mount(panelEl)` найти `panelEl.querySelector('.tc-right-header-actions')` и _appendChild_ туда close button (не absolute).
- Убрать `position: absolute` с `.tc-modal-close-btn`.
- Чипы наследуют `.tc-chip` — проверить что `.tc-modal-body` не сбрасывает стили.

---

### B12 — Календарь: навигационная панель

**Проблема:** стрелки на краях экрана, title между ними слишком далеко.

**Решение:**
- Перестроить nav: левая группа `[<] [Month Year] [>]`, правая группа `[Today] [Month|Week|List]`.
- CSS: `tc-cal-nav { display:flex; align-items:center; justify-content:space-between }`. Левая группа — `tc-cal-nav-left { display:flex; gap:4px; align-items:center }`.
- Title: `<button class="tc-cal-nav-month">June</button> <button class="tc-cal-nav-year">2026</button>` — клик по месяцу показывает сетку 12 месяцев, клик по году — список лет ±5.
- Добавить style-selector: маленькая кнопка 🎨 в правой группе, при клике циклически переключает стили style1→style2→...→style11→style1 (cycle, не dropdown — проще и эффективнее для 11 стилей).

---

### B13 — Кнопки вида: active-стиль

**Проблема:** выделение "Today" кнопки — фиолетовый контур выглядит плохо.

**Решение:** `.tc-cal-view-btn.is-active, .tc-cal-nav-today.is-active { background: var(--interactive-accent); color: white; border: none; outline: none; }` Нет `box-shadow`, нет border-outline.

---

### B14 — List view: информативность

**Проблема:** список показывает ISO-даты и пустые задачи.

**Решение:** Переписать `ListView.ts`:
- Дата-хедер: `formatListDate(date)` → "Today", "Yesterday", "Mon, 23 Jun" и т.д.
- Задачи: компактные карточки с title + мета (время, теги, прогресс) — как в центральной панели
- Показывать overdue задачи с меткой

---

### B15 — Calendar styles: вернуть переключатель

**Проблема:** style1-style11 применяются из настроек статично, нет UI переключения.

**Решение:** В `CenterPanel`: добавить `private calStyle: string` (начальное значение из settings). В nav добавить кнопку-dropdown для выбора стиля (cycle 1-11 или dropdown). `viewContainer` обновляет className при смене стиля.

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/panels/CenterPanel.ts` | B1, B8, B9, B12, B13, B14, B15 |
| `src/panels/RightPanel.ts` | B3, B4, B5, B6, B7 |
| `src/panels/LeftPanel.ts` | B10 |
| `src/ui/TaskModal.ts` | B11 |
| `src/views/ListView.ts` | B14 |
| `styles.css` | B2, B3, B11, B12, B13 |
