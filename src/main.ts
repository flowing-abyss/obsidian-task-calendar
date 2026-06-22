import {
	App,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";

interface CalendarPluginSettings {
	addToToday: boolean;
	customFilePath: string;
	taskPrefix: string;
}

const DEFAULT_SETTINGS: CalendarPluginSettings = {
	addToToday: true,
	customFilePath: "",
	taskPrefix: "#task/one-off",
};

export default class CalendarPlugin extends Plugin {
	settings: CalendarPluginSettings;
	async onload() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
		this.addSettingTab(new CalendarSettingTab(this.app, this));
		(window as any).renderCalendar = renderCalendar;
		(window as any).calendarPluginSettings = this.settings;
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
	onunload() {
		delete (window as any).renderCalendar;
	}
}

class CalendarSettingTab extends PluginSettingTab {
	plugin: CalendarPlugin;
	constructor(app: App, plugin: CalendarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName("Add to today's note")
			.setDesc(
				"If enabled, tasks will be added to today's periodic note."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.addToToday)
					.onChange(async (value) => {
						this.plugin.settings.addToToday = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);
		if (!this.plugin.settings.addToToday) {
			new Setting(containerEl)
				.setName("Custom file path")
				.setDesc(
					"If set, tasks will be added to this file instead of the daily note."
				)
				.addText((text) =>
					text
						.setPlaceholder("periodic/daily/2024-06-10.md")
						.setValue(this.plugin.settings.customFilePath)
						.onChange(async (value) => {
							this.plugin.settings.customFilePath = value;
							await this.plugin.saveSettings();
						})
				);
		}
		new Setting(containerEl)
			.setName("Task prefix")
			.setDesc("Prefix to add before the task text (e.g. #task/one-off).")
			.addText((text) =>
				text
					.setPlaceholder("#task/one-off")
					.setValue(this.plugin.settings.taskPrefix)
					.onChange(async (value) => {
						this.plugin.settings.taskPrefix = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

// Helper functions
function capitalize(str: string): string {
	return str[0].toUpperCase() + str.slice(1);
}

function getFilename(path: string): string {
	const match = path.match(/^(?:.*\/)?([^\/]+?|)(?=(?:\.[^\/.]*)?$)/);
	return match ? match[1] : path;
}

function getMetaFromNote(dv: any, task: any, metaName: string): string {
	const meta = dv.pages(`"${task.link.path}"`)[metaName]?.[0];
	return meta || "";
}

function momentToRegex(momentFormat: string): string {
	let fmt = momentFormat;
	fmt = fmt.split(".").join("\\.");
	fmt = fmt.split(",").join("\\,");
	fmt = fmt.split("-").join("\\-");
	fmt = fmt.split(":").join("\\:");
	fmt = fmt.split(" ").join("\\s");

	fmt = fmt.replace("dddd", "\\w{1,}");
	fmt = fmt.replace("ddd", "\\w{1,3}");
	fmt = fmt.replace("dd", "\\w{2}");
	fmt = fmt.replace("d", "\\d{1}");

	fmt = fmt.replace("YYYY", "\\d{4}");
	fmt = fmt.replace("YY", "\\d{2}");

	fmt = fmt.replace("MMMM", "\\w{1,}");
	fmt = fmt.replace("MMM", "\\w{3}");
	fmt = fmt.replace("MM", "\\d{2}");

	fmt = fmt.replace("DDDD", "\\d{3}");
	fmt = fmt.replace("DDD", "\\d{1,3}");
	fmt = fmt.replace("DD", "\\d{2}");
	fmt = fmt.replace("D", "\\d{1,2}");

	fmt = fmt.replace("ww", "\\d{1,2}");

	return `^(${fmt})$`;
}

export async function renderCalendar(dv: any, params: any) {
	// Destructuring parameters
	let {
		pages,
		view,
		firstDayOfWeek,
		globalTaskFilter,
		dailyNoteFolder,
		dailyNoteFormat,
		startPosition,
		upcomingDays,
		css,
		options,
	} = params;

	// Cache static moment values for this render
	const now = window.moment();
	const tToday = now.format("YYYY-MM-DD");
	const tMonth = now.format("M");
	const tDay = now.format("d");
	const tYear = now.format("YYYY");
	const tid = new Date().getTime();

	// Parameter checks
	if (!pages && pages !== "") {
		dv.span(
			'> [!ERROR] Missing pages parameter\n> \n> Please set the pages parameter like\n> \n> `pages: ""`'
		);
		return false;
	}
	if (!options || !options.includes("style")) {
		dv.span(
			'> [!ERROR] Missing style parameter\n> \n> Please set a style inside options parameter like\n> \n> `options: "style1"`'
		);
		return false;
	}
	if (!view) {
		dv.span(
			'> [!ERROR] Missing view parameter\n> \n> Please set a default view inside view parameter like\n> \n> `view: "month"`'
		);
		return false;
	}
	if (firstDayOfWeek) {
		if (!firstDayOfWeek.match(/[|\\0123456]/g)) {
			dv.span(
				"> [!ERROR] Wrong value inside firstDayOfWeek parameter\n> \n> Please choose a number between 0 and 6"
			);
			return false;
		}
	} else {
		dv.span(
			'> [!ERROR] Missing firstDayOfWeek parameter\n> \n> Please set the first day of the week inside firstDayOfWeek parameter like\n> \n> `firstDayOfWeek: "1"`'
		);
		return false;
	}
	if (startPosition) {
		if (!startPosition.match(/\d{4}\-\d{1,2}/gm)) {
			dv.span(
				"> [!ERROR] Wrong startPosition format\n> \n> Please set a startPosition with the following format\n> \n> Month: `YYYY-MM` | Week: `YYYY-ww`"
			);
			return false;
		}
	}
	if (dailyNoteFormat) {
		if (
			dailyNoteFormat.match(/[|\\YMDWwd.,-: \[\]]/g)?.length !==
			dailyNoteFormat.length
		) {
			dv.span(
				"> [!ERROR] The `dailyNoteFormat` contains invalid characters"
			);
			return false;
		}
	}

	// Getting tasks
	let tasks: any[] = [];
	if (pages === "") {
		tasks = dv.pages().file.tasks;
	} else if (typeof pages === "string" && pages.startsWith("dv.pages")) {
		// Example: pages = 'dv.pages("#tag")'
		// Remove quotes if present
		const match = pages.match(/^dv\.pages\((.*)\)$/);
		if (match) {
			const arg = match[1].trim();
			// Remove quotes if present
			const argValue = arg.replace(/^['\"`](.*)['\"`]$/, "$1");
			tasks = dv.pages(argValue).file.tasks;
		} else {
			tasks = [];
		}
	} else if (Array.isArray(pages) && pages.every((p: any) => p.task)) {
		tasks = pages;
	} else {
		tasks = dv.pages(pages).file.tasks;
	}

	// --- Templates and icons ---
	const arrowLeftIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>`;
	const arrowRightIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`;
	const filterIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>`;
	const monthIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path></svg>`;
	const weekIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M17 14h-6"></path><path d="M13 18H7"></path><path d="M7 14h.01"></path><path d="M17 18h.01"></path></svg>`;
	const listIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`;
	const calendarClockIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"></path><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h5"></path><path d="M17.5 17.5 16 16.25V14"></path><path d="M22 16a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"></path></svg>`;
	const calendarCheckIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="m9 16 2 2 4-4"></path></svg>`;
	const calendarHeartIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h7"></path><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path><path d="M21.29 14.7a2.43 2.43 0 0 0-2.65-.52c-.3.12-.57.3-.8.53l-.34.34-.35-.34a2.43 2.43 0 0 0-2.65-.53c-.3.12-.56.3-.79.53-.95.94-1 2.53.2 3.74L17.5 22l3.6-3.55c1.2-1.21 1.14-2.8.19-3.74Z"></path></svg>`;
	const cellTemplate =
		"<div class='cell {{class}}' data-weekday='{{weekday}}'><a class='internal-link cellName' href='{{dailyNote}}'>{{cellName}}</a><div class='cellContent'>{{cellContent}}</div></div>";
	const taskTemplate =
		"<div class='task {{class}}' style='{{style}}' title='{{title}}'><div class='inner'><input type='checkbox' class='calendar-task-checkbox' data-task-path='{{filePath}}' data-task-line='{{taskLine}}' {{checked}}><a class='internal-link' href='{{taskPath}}'><div class='note'>{{note}}</div><div class='icon'>{{icon}}</div><div class='description' data-relative='{{relative}}'>{{taskContent}}</div></a></div></div>";

	const taskDoneIcon = "✅";
	const taskDueIcon = "📅";
	const taskScheduledIcon = "⏳";
	const taskRecurrenceIcon = "🔁";
	const taskOverdueIcon = "⚠️";
	const taskProcessIcon = "⏺️";
	const taskCancelledIcon = "🚫";
	const taskStartIcon = "🛫";
	const taskDailyNoteIcon = "📄";

	// --- Tasks icons dictionary ---
	const taskIcons: Record<string, string> = {
		done: taskDoneIcon,
		due: taskDueIcon,
		scheduled: taskScheduledIcon,
		recurrence: taskRecurrenceIcon,
		overdue: taskOverdueIcon,
		process: taskProcessIcon,
		cancelled: taskCancelledIcon,
		start: taskStartIcon,
		dailyNote: taskDailyNoteIcon,
	};

	// Root element of the calendar
	const rootNode = dv.el("div", "", {
		cls: "tasksCalendar " + options,
		attr: {
			id: "tasksCalendar" + tid,
			view: view,
			style: "position:relative;-webkit-user-select:none!important",
		},
	});
	if (css) {
		const style = document.createElement("style");
		style.innerHTML = css;
		rootNode.append(style);
	}

	// --- Helper functions and variables for tasks ---
	function getMeta(tasks: any[]) {
		for (let i = 0; i < tasks.length; i++) {
			let taskText = tasks[i].text;
			let taskFile = getFilename(tasks[i].path);
			// dailyNoteMatch and dailyTaskMatch are not used for calculations, can be simplified
			let dailyNoteMatch = taskFile.match(
				new RegExp(momentToRegex(dailyNoteFormat))
			);
			let dailyTaskMatch = taskText.match(/(\d{4}\-\d{2}\-\d{2})/);
			if (dailyNoteMatch && !dailyTaskMatch) {
				tasks[i].dailyNote = window
					.moment(dailyNoteMatch[1], dailyNoteFormat)
					.format("YYYY-MM-DD");
			}
			let dueMatch = taskText.match(/\📅\s*(\d{4}-\d{2}-\d{2})/);
			if (dueMatch) {
				tasks[i].due = dueMatch[1];
				tasks[i].text = tasks[i].text.replace(dueMatch[0], "");
			}
			let startMatch = taskText.match(/\🛫\s*(\d{4}-\d{2}-\d{2})/);
			if (startMatch) {
				tasks[i].start = startMatch[1];
				tasks[i].text = tasks[i].text.replace(startMatch[0], "");
			}
			let scheduledMatch = taskText.match(/\⏳\s*(\d{4}-\d{2}-\d{2})/);
			if (scheduledMatch) {
				tasks[i].scheduled = scheduledMatch[1];
				tasks[i].text = tasks[i].text.replace(scheduledMatch[0], "");
			}
			let completionMatch = taskText.match(/\✅\s*(\d{4}-\d{2}-\d{2})/);
			if (completionMatch) {
				tasks[i].completion = completionMatch[1];
				tasks[i].text = tasks[i].text.replace(completionMatch[0], "");
			}
			let timeMatch = taskText.match(/\⏰\W(\d{1,2}:\d{2})/);
			if (timeMatch) {
				let time = timeMatch[1];
				tasks[i].text = tasks[i].text.replace(timeMatch[0], "");
				tasks[i].text = "⏰ " + time + " " + tasks[i].text;
			}
			let repeatMatch = taskText.includes("🔁");
			if (repeatMatch) {
				tasks[i].recurrence = true;
				tasks[i].text = tasks[i].text.replace("🔁", "").trim();
			}
			let lowMatch = taskText.includes("🔽");
			if (lowMatch) tasks[i].priority = "D";
			let mediumMatch = taskText.includes("🔼");
			if (mediumMatch) tasks[i].priority = "B";
			let highMatch = taskText.includes("⏫");
			if (highMatch) tasks[i].priority = "A";
			if (!lowMatch && !mediumMatch && !highMatch)
				tasks[i].priority = "C";
			if (globalTaskFilter) {
				tasks[i].text = tasks[i].text.split(globalTaskFilter).join("");
			} else {
				tasks[i].text = tasks[i].text.replace(/#[\w/-]+/g, "");
			}
			tasks[i].text = tasks[i].text.replace(
				/\[\[([^|\]]+)\|([^\]]+)\]\]/g,
				"🔗$1"
			);
			tasks[i].text = tasks[i].text.replace(
				/\[\[([^\]]+)\]\]/g,
				(_: string, link: string) =>
					"🔗 " + link.replace(/\.[^.]*$/, "")
			);
			tasks[i].text = tasks[i].text.replace(
				/\[([^\]]+)\]\([^)]+\)/g,
				"🌐 $1"
			);
			tasks[i].text = tasks[i].text.replace(/\[([^\]]*)\]/g, "$1");
			if (/\#task\/regular\b/.test(taskText)) {
				tasks[i].text = "🔁 " + tasks[i].text;
			}
		}
	}

	function getTasksForDate(tasks: any[], date: string) {
		const today = window.moment().format("YYYY-MM-DD");
		// Completed tasks: show by due date, not by completion date
		const allDone = tasks
			.filter(
				(t) =>
					t.completed &&
					t.checked &&
					t.due &&
					window.moment(t.due.toString()).isSame(date)
			)
			.sort((a, b) => a.due.localeCompare(b.due));
		// Completed tasks without due date (fallback to completion date, but rarely used)
		const allDoneNoDue = tasks
			.filter(
				(t) =>
					t.completed &&
					t.checked &&
					!t.due &&
					t.completion &&
					window.moment(t.completion.toString()).isSame(date)
			)
			.sort((a, b) => a.completion.localeCompare(b.completion));
		// Other groupings remain the same
		const due = tasks
			.filter(
				(t) =>
					!t.completed &&
					!t.checked &&
					!t.recurrence &&
					t.due &&
					window.moment(t.due.toString()).isSame(date)
			)
			.sort((a, b) => a.due.localeCompare(b.due));
		const recurrence = tasks
			.filter(
				(t) =>
					!t.completed &&
					!t.checked &&
					t.recurrence &&
					t.due &&
					window.moment(t.due.toString()).isSame(date)
			)
			.sort((a, b) => a.due.localeCompare(b.due));
		const overdue = tasks
			.filter(
				(t) =>
					!t.completed &&
					!t.checked &&
					t.due &&
					window.moment(t.due.toString()).isBefore(today)
			)
			.sort((a, b) => a.due.localeCompare(b.due));
		const start = tasks
			.filter(
				(t) =>
					!t.completed &&
					!t.checked &&
					t.start &&
					window.moment(t.start.toString()).isSame(date)
			)
			.sort((a, b) => a.start.localeCompare(b.start));
		const scheduled = tasks
			.filter(
				(t) =>
					!t.completed &&
					!t.checked &&
					t.scheduled &&
					window.moment(t.scheduled.toString()).isSame(date)
			)
			.sort((a, b) => a.scheduled.localeCompare(b.scheduled));
		const process = tasks.filter(
			(t) =>
				!t.completed &&
				!t.checked &&
				t.due &&
				t.start &&
				window.moment(t.due.toString()).isAfter(date) &&
				window.moment(t.start.toString()).isBefore(date)
		);
		const cancelled = tasks
			.filter(
				(t) =>
					!t.completed &&
					t.checked &&
					t.due &&
					window.moment(t.due.toString()).isSame(date)
			)
			.sort((a, b) => a.due.localeCompare(b.due));
		const dailyNote = tasks
			.filter(
				(t) =>
					!t.completed &&
					!t.checked &&
					t.dailyNote &&
					window.moment(t.dailyNote.toString()).isSame(date)
			)
			.sort((a, b) => a.dailyNote.localeCompare(b.dailyNote));
		return {
			allDone: allDone.concat(allDoneNoDue),
			due,
			recurrence,
			overdue,
			start,
			scheduled,
			process,
			cancelled,
			dailyNote,
		};
	}

	function setTask(obj: any, cls: string): string {
		const lighter = 25;
		const darker = -40;
		const noteColor = getMetaFromNote(dv, obj, "color");
		const textColor = getMetaFromNote(dv, obj, "textColor");
		const noteIcon = getMetaFromNote(dv, obj, "icon");
		let taskText = obj.text.replace("'", "&apos;");
		let taskPath = obj.link.path.replace("'", "&apos;");
		const taskIcon = taskIcons[cls] || "";
		const relative = obj.due ? window.moment(obj.due).fromNow() : "";
		let noteFilename = getFilename(taskPath);
		if (noteIcon) {
			noteFilename = noteIcon + "&nbsp;" + noteFilename;
		} else {
			noteFilename = taskIcon + "&nbsp;" + noteFilename;
			cls += " noNoteIcon";
		}
		const taskSubpath = obj.header?.subpath;
		const checked = obj.completed || obj.checked ? "checked" : "";
		// Use the file path and line number for precise task identification
		const filePathLocal =
			obj.path || (obj.file && obj.file.path) || obj.link.path || "";
		const filePathNoExtLocal = filePathLocal.replace(/\.md$/, "");
		const taskLineLocal = typeof obj.line === "number" ? obj.line : 0;
		let style = "";
		if (noteColor && textColor) {
			style = `--task-background:${noteColor}33;--task-color:${noteColor};--dark-task-text-color:${textColor};--light-task-text-color:${textColor}`;
		} else if (noteColor && !textColor) {
			style = `--task-background:${noteColor}33;--task-color:${noteColor};--dark-task-text-color:${transColor(
				noteColor,
				darker
			)};--light-task-text-color:${transColor(noteColor, lighter)}`;
		} else if (!noteColor && textColor) {
			style = `--task-background:#7D7D7D33;--task-color:#7D7D7D;--dark-task-text-color:${transColor(
				textColor,
				darker
			)};--light-task-text-color:${transColor(textColor, lighter)}`;
		} else {
			style = `--task-background:#7D7D7D33;--task-color:#7D7D7D;--dark-task-text-color:${transColor(
				"#7D7D7D",
				darker
			)};--light-task-text-color:${transColor("#7D7D7D", lighter)}`;
		}
		let newTask = taskTemplate
			.replace("{{taskContent}}", taskText)
			.replace("{{class}}", cls)
			.replace("{{filePath}}", filePathLocal)
			.replace("{{taskPath}}", filePathNoExtLocal)
			.replace("{{taskLine}}", taskLineLocal)
			.replace("{{checked}}", checked)
			.split("{{style}}")
			.join(style)
			.replace("{{title}}", taskText)
			.replace("{{note}}", noteFilename)
			.replace("{{icon}}", taskIcon)
			.replace("{{relative}}", relative);
		let dueAttr = obj.due ? ` data-due='${obj.due}'` : "";
		newTask = newTask.replace(
			"<div ",
			`<div data-task-text="${taskText.replace(
				/"/g,
				"&quot;"
			)}"${dueAttr} `
		);
		return newTask;
	}

	function setTaskContentContainer(
		currentDate: string,
		tasks: any[]
	): string {
		let cellContent = "";
		const {
			allDone,
			due,
			recurrence,
			overdue,
			start,
			scheduled,
			process,
			cancelled,
			dailyNote,
		} = getTasksForDate(tasks, currentDate);
		function compareFn(a: any, b: any) {
			if (a.priority.toUpperCase() < b.priority.toUpperCase()) return -1;
			if (a.priority.toUpperCase() > b.priority.toUpperCase()) return 1;
			if (a.priority === b.priority) {
				if (a.text.toUpperCase() < b.text.toUpperCase()) return -1;
				if (a.text.toUpperCase() > b.text.toUpperCase()) return 1;
				return 0;
			}
			return 0;
		}
		function showTasks(tasksToShow: any[], type: string) {
			const sorted = [...tasksToShow].sort(compareFn);
			for (let t = 0; t < sorted.length; t++) {
				cellContent += setTask(sorted[t], type);
			}
		}
		if (tToday === currentDate) showTasks(overdue, "overdue");
		showTasks(due, "due");
		showTasks(recurrence, "recurrence");
		showTasks(start, "start");
		showTasks(scheduled, "scheduled");
		showTasks(process, "process");
		showTasks(dailyNote, "dailyNote");
		showTasks(allDone, "done");
		showTasks(cancelled, "cancelled");
		return cellContent;
	}

	// --- Calendar rendering ---
	function removeExistingView() {
		const grid = rootNode.querySelector(".grid");
		if (grid) grid.remove();
	}

	function setStatisticValues(
		dueCounter: number,
		doneCounter: number,
		overdueCounter: number,
		startCounter: number,
		scheduledCounter: number,
		recurrenceCounter: number,
		dailyNoteCounter: number
	) {
		// Always fully overwrite innerHTML so that labels and icons are not lost
		const set = (
			id: string,
			icon: string,
			label: string,
			value: number
		) => {
			const el = rootNode.querySelector(`#${id}`);
			if (el) {
				el.innerHTML = `${icon} <span class="stat-label">${label}</span> <span class="stat-count">${value}</span>`;
			}
		};
		set("statisticDone", "✅", "Done", doneCounter);
		set("statisticDue", "📅", "Due", dueCounter);
		set("statisticOverdue", "⚠️", "Overdue", overdueCounter);
		set("statisticStart", "🛫", "Start", startCounter);
		set("statisticScheduled", "⏳", "Scheduled", scheduledCounter);
		set("statisticRecurrence", "🔁", "Recurring", recurrenceCounter);
		set("statisticDailyNote", "📄", "Daily", dailyNoteCounter);

		// Add an icon to the statistics button if svg is not used
		const statBtn = rootNode.querySelector("button.statistic");
		if (statBtn && !statBtn.innerHTML.trim()) {
			statBtn.innerHTML = "📊";
		}
	}

	function setWrapperEvents() {
		rootNode.querySelectorAll(".wrapperButton").forEach((wBtn: any) =>
			wBtn.addEventListener("click", () => {
				const week = wBtn.getAttribute("data-week");
				const year = wBtn.getAttribute("data-year");
				selectedDate = window
					.moment()
					.isoWeekYear(year)
					.isoWeek(week)
					.startOf("isoWeek");
				const grid = rootNode.querySelector(
					`#tasksCalendar${tid} .grid`
				);
				if (grid) grid.remove();
				getWeek(tasks, selectedDate);
			})
		);
	}

	function setStatisticPopUpEvents() {
		rootNode.querySelectorAll(".statisticPopup li").forEach((li: any) =>
			li.addEventListener("click", () => {
				const group = li.getAttribute("data-group");
				const liElements =
					rootNode.querySelectorAll(".statisticPopup li");
				if (li.classList.contains("active")) {
					liElements.forEach((el: any) =>
						el.classList.remove("active")
					);
					rootNode.classList.remove("focus" + capitalize(group));
					// Remove highlighting from tasks
					rootNode.querySelectorAll(".task").forEach((task: any) => {
						task.classList.remove("highlighted");
					});
				} else {
					liElements.forEach((el: any) =>
						el.classList.remove("active")
					);
					li.classList.add("active");
					rootNode.classList.remove(
						...Array.from(rootNode.classList).filter((v: string) =>
							v.startsWith("focus")
						)
					);
					rootNode.classList.add("focus" + capitalize(group));
					// Highlight only for overdue tasks
					if (group === "overdue") {
						const today = window.moment().format("YYYY-MM-DD");
						rootNode
							.querySelectorAll(".task")
							.forEach((task: any) => {
								const due = task.getAttribute("data-due");
								if (
									due &&
									window.moment(due).isBefore(today) &&
									!task.classList.contains("done") &&
									!task.classList.contains("cancelled")
								) {
									task.classList.add("highlighted");
								}
							});
					}
				}
			})
		);
	}

	function setStatisticPopUp() {
		// Remove old popup if it exists
		const oldPopup = rootNode.querySelector(".statisticPopup");
		if (oldPopup) oldPopup.remove();

		let statistic =
			"<li id='statisticDone' data-group='done'>✅ <span class='stat-label'>Done</span></li>";
		statistic +=
			"<li id='statisticDue' data-group='due'>📅 <span class='stat-label'>Due</span></li>";
		statistic += "<li class='break'></li>";
		statistic +=
			"<li id='statisticStart' data-group='start'>🛫 <span class='stat-label'>Start</span></li>";
		statistic +=
			"<li id='statisticScheduled' data-group='scheduled'>⏳ <span class='stat-label'>Scheduled</span></li>";
		statistic +=
			"<li id='statisticRecurrence' data-group='recurrence'>🔁 <span class='stat-label'>Recurring</span></li>";
		statistic += "<li class='break'></li>";
		statistic +=
			"<li id='statisticDailyNote' data-group='dailyNote'>📄 <span class='stat-label'>Daily</span></li>";

		// Use regular DOM, not dv.el
		const ul = document.createElement("ul");
		ul.className = "statisticPopup";
		ul.innerHTML = statistic;
		rootNode.querySelector("span")?.appendChild(ul);
		setStatisticPopUpEvents();
	}

	function setWeekViewContextEvents() {
		rootNode.querySelectorAll(".weekViewContext li").forEach((li: any) =>
			li.addEventListener("click", () => {
				const selectedStyle = li.getAttribute("data-style");
				const liElements = rootNode.querySelectorAll(
					".weekViewContext li"
				);
				if (!li.classList.contains("active")) {
					liElements.forEach((el: any) =>
						el.classList.remove("active")
					);
					li.classList.add("active");
					rootNode.classList.remove(
						...Array.from(rootNode.classList).filter((v: string) =>
							v.startsWith("style")
						)
					);
					rootNode.classList.add(selectedStyle);
				}
				rootNode
					.querySelector(".weekViewContext")
					?.classList.toggle("active");
			})
		);
	}

	function setWeekViewContext() {
		const activeStyle = Array.from(rootNode.classList).find((v: string) =>
			v.startsWith("style")
		);
		let liElements = "";
		const styles = 11;
		for (let i = 1; i < styles + 1; i++) {
			const liIcon = `<div class='liIcon iconStyle${i}'><div class='box'></div><div class='box'></div><div class='box'></div><div class='box'></div><div class='box'></div><div class='box'></div><div class='box'></div></div>`;
			liElements += `<li data-style='style${i}'>${liIcon}Style ${i}</li>`;
		}
		rootNode
			.querySelector("span")
			?.appendChild(dv.el("ul", liElements, { cls: "weekViewContext" }));
		const activeLi = rootNode.querySelector(
			`.weekViewContext li[data-style='${activeStyle}']`
		);
		if (activeLi) activeLi.classList.add("active");
		setWeekViewContextEvents();
	}

	function setButtons() {
		// Remove old button container if it exists
		const oldButtons = rootNode.querySelector(".buttons");
		if (oldButtons) oldButtons.remove();
		const buttonsDiv = document.createElement("div");
		buttonsDiv.className = "buttons";

		// Buttons and their parameters
		const btns = [
			{ cls: "filter", icon: filterIcon, title: "" },
			{ cls: "listView", icon: listIcon, title: "List" },
			{ cls: "monthView", icon: monthIcon, title: "Month" },
			{ cls: "weekView", icon: weekIcon, title: "Week" },
			{ cls: "current", icon: "", title: "" },
			{ cls: "previous", icon: arrowLeftIcon, title: "" },
			{ cls: "next", icon: arrowRightIcon, title: "" },
			{
				cls: "overdueHighlighter",
				icon: "⚠️",
				title: "Highlight overdue tasks",
				onClick: function (btn: HTMLButtonElement) {
					const isActive = btn.classList.contains("active");
					// Remove highlighting from tasks
					rootNode.querySelectorAll(".task").forEach((task: any) => {
						task.classList.remove("highlighted");
					});
					// Remove active from statistic
					rootNode
						.querySelectorAll("button.statistic")
						.forEach((b: any) => b.classList.remove("active"));
					if (!isActive) {
						// Highlight overdue tasks
						const today = window.moment().format("YYYY-MM-DD");
						rootNode
							.querySelectorAll(".task")
							.forEach((task: any) => {
								const due = task.getAttribute("data-due");
								if (
									due &&
									window.moment(due).isBefore(today) &&
									!task.classList.contains("done") &&
									!task.classList.contains("cancelled")
								) {
									task.classList.add("highlighted");
								}
							});
						btn.classList.add("active");
					} else {
						btn.classList.remove("active");
					}
				},
			},
			{
				cls: "statistic",
				icon: "",
				title: "",
				onClick: function (btn: HTMLButtonElement) {
					const popup = rootNode.querySelector(".statisticPopup");
					const isActive = btn.classList.contains("active");
					// Remove active from overdueHighlighter
					rootNode
						.querySelectorAll("button.overdueHighlighter")
						.forEach((b: any) => b.classList.remove("active"));
					if (!isActive) {
						btn.classList.add("active");
						popup?.classList.add("active");
						// Listener for click outside popup — remove active
						const closePopup = (e: MouseEvent) => {
							if (
								popup &&
								!popup.contains(e.target as Node) &&
								e.target !== btn
							) {
								popup.classList.remove("active");
								btn.classList.remove("active");
								document.removeEventListener(
									"mousedown",
									closePopup
								);
							}
						};
						setTimeout(
							() =>
								document.addEventListener(
									"mousedown",
									closePopup
								),
							0
						);
					} else {
						btn.classList.remove("active");
						popup?.classList.remove("active");
					}
				},
			},
		];

		btns.forEach(({ cls, icon, title, onClick }) => {
			const btn = document.createElement("button");
			btn.className = cls;
			if (icon) btn.innerHTML = icon;
			if (title) btn.title = title;
			if (cls === "statistic") btn.setAttribute("percentage", "");
			if (typeof onClick === "function") {
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					onClick(btn);
					btn.blur();
				});
			}
			buttonsDiv.appendChild(btn);
		});

		rootNode.querySelector("span")?.appendChild(buttonsDiv);
		setButtonEvents();
	}

	function setButtonEvents() {
		rootNode.querySelectorAll("button").forEach((btn: any) =>
			btn.addEventListener("click", () => {
				const activeView = rootNode.getAttribute("view");
				if (btn.className === "previous") {
					if (activeView === "month") {
						selectedDate = window
							.moment(selectedDate)
							.subtract(1, "months");
						getMonth(tasks, selectedDate);
					} else if (activeView === "week") {
						selectedDate = window
							.moment(selectedDate)
							.subtract(7, "days")
							.startOf("week");
						getWeek(tasks, selectedDate);
					} else if (activeView === "list") {
						selectedDate = window
							.moment(selectedDate)
							.subtract(1, "months");
						getList(tasks, selectedDate);
					}
				} else if (btn.className === "current") {
					if (activeView === "month") {
						selectedDate = window.moment().date(1);
						getMonth(tasks, selectedDate);
					} else if (activeView === "week") {
						selectedDate = window.moment().startOf("week");
						getWeek(tasks, selectedDate);
					} else if (activeView === "list") {
						selectedDate = window.moment().date(1);
						getList(tasks, selectedDate);
					}
				} else if (btn.className === "next") {
					if (activeView === "month") {
						selectedDate = window
							.moment(selectedDate)
							.add(1, "months");
						getMonth(tasks, selectedDate);
					} else if (activeView === "week") {
						selectedDate = window
							.moment(selectedDate)
							.add(7, "days")
							.startOf("week");
						getWeek(tasks, selectedDate);
					} else if (activeView === "list") {
						selectedDate = window
							.moment(selectedDate)
							.add(1, "months");
						getList(tasks, selectedDate);
					}
				} else if (btn.className === "filter") {
					rootNode.classList.toggle("filter");
					rootNode
						.querySelector("#statisticDone")
						?.classList.remove("active");
					rootNode.classList.remove("focusDone");
				} else if (btn.className === "monthView") {
					selectedDate = window.moment(selectedDate).date(1);
					getMonth(tasks, selectedDate);
				} else if (btn.className === "listView") {
					selectedDate = window.moment(selectedDate).date(1);
					getList(tasks, selectedDate);
				} else if (btn.className === "weekView") {
					if (rootNode.getAttribute("view") === "week") {
						const leftPos =
							rootNode.querySelector(
								"button.weekView"
							).offsetLeft;
						rootNode.querySelector(".weekViewContext").style.left =
							leftPos + "px";
						rootNode
							.querySelector(".weekViewContext")
							.classList.toggle("active");
						if (
							rootNode
								.querySelector(".weekViewContext")
								.classList.contains("active")
						) {
							const closeContextListener = function () {
								rootNode
									.querySelector(".weekViewContext")
									.classList.remove("active");
								rootNode.removeEventListener(
									"click",
									closeContextListener,
									false
								);
							};
							setTimeout(function () {
								rootNode.addEventListener(
									"click",
									closeContextListener,
									false
								);
							}, 100);
						}
					} else {
						selectedDate = window
							.moment(selectedDate)
							.startOf("week");
						getWeek(tasks, selectedDate);
					}
				}
				btn.blur();
			})
		);
		rootNode.addEventListener("contextmenu", function (event: any) {
			event.preventDefault();
		});
	}

	// --- Main render functions ---
	let selectedDate: any;
	if (startPosition) {
		selectedDate = window.moment(startPosition, "YYYY-MM").date(1);
		if (view === "week")
			selectedDate = window
				.moment(startPosition, "YYYY-ww")
				.startOf("week");
	} else {
		selectedDate = window.moment().date(1);
		if (view === "week") selectedDate = window.moment().startOf("week");
	}

	getMeta(tasks);
	setButtons();
	setStatisticPopUp();
	setWeekViewContext();

	function getMonth(tasks: any[], month: any) {
		removeExistingView();
		const currentTitle = `<span>${window
			.moment(month)
			.format("MMMM")}</span><span> ${window
			.moment(month)
			.format("YYYY")}</span>`;
		rootNode.querySelector("button.current").innerHTML = currentTitle;
		let gridContent = "";
		const firstDayOfMonth = parseInt(window.moment(month).format("d"));
		const lastDateOfMonth = parseInt(
			window.moment(month).endOf("month").format("D")
		);
		let dueCounter = 0,
			doneCounter = 0,
			overdueCounter = 0,
			startCounter = 0,
			scheduledCounter = 0,
			recurrenceCounter = 0,
			dailyNoteCounter = 0;
		let gridHeads = "";
		for (
			let h = 0 - firstDayOfMonth + parseInt(firstDayOfWeek);
			h < 7 - firstDayOfMonth + parseInt(firstDayOfWeek);
			h++
		) {
			const weekDayNr = window.moment(month).add(h, "days").format("d");
			const weekDayName = window
				.moment(month)
				.add(h, "days")
				.format("ddd");
			if (
				tDay == weekDayNr &&
				tMonth == window.moment(month).format("M") &&
				tYear == window.moment(month).format("YYYY")
			) {
				gridHeads += `<div class='gridHead today' data-weekday='${weekDayNr}'>${weekDayName}</div>`;
			} else {
				gridHeads += `<div class='gridHead' data-weekday='${weekDayNr}'>${weekDayName}</div>`;
			}
		}
		let wrappers = "";
		let starts = 0 - firstDayOfMonth + parseInt(firstDayOfWeek);
		for (let w = 1; w < 7; w++) {
			let wrapper = "";
			let weekNr = "";
			let yearNr = "";
			const monthName = window
				.moment(month)
				.format("MMM")
				.replace(".", "")
				.substring(0, 3);
			for (let i = starts; i < starts + 7; i++) {
				if (i == starts) {
					weekNr = window.moment(month).add(i, "days").format("w");
					yearNr = window.moment(month).add(i, "days").format("YYYY");
				}
				const currentDate = window
					.moment(month)
					.add(i, "days")
					.format("YYYY-MM-DD");
				if (
					window.moment(month).format("MM") ===
					window.moment(month).add(i, "days").format("MM")
				) {
					const stats = getTasksForDate(tasks, currentDate);
					dueCounter += stats.due.length;
					doneCounter += stats.allDone.length;
					startCounter += stats.start.length;
					scheduledCounter += stats.scheduled.length;
					recurrenceCounter += stats.recurrence.length;
					dailyNoteCounter += stats.dailyNote.length;
				}
				const dailyNotePath = dailyNoteFolder
					? `${dailyNoteFolder}/${currentDate}`
					: currentDate;
				const weekDay = window.moment(month).add(i, "days").format("d");
				const shortDayName = window
					.moment(month)
					.add(i, "days")
					.format("D");
				const longDayName = window
					.moment(month)
					.add(i, "days")
					.format("D. MMM");
				const cellContent = setTaskContentContainer(currentDate, tasks);
				let cell = "";
				if (window.moment(month).add(i, "days").format("D") == "1") {
					cell = cellTemplate
						.replace("{{date}}", currentDate)
						.replace("{{cellName}}", longDayName)
						.replace("{{cellContent}}", cellContent)
						.replace("{{weekday}}", weekDay)
						.replace("{{dailyNote}}", dailyNotePath)
						.replace("{{class}}", "{{class}} newMonth");
				} else {
					cell = cellTemplate
						.replace("{{date}}", currentDate)
						.replace("{{cellName}}", shortDayName)
						.replace("{{cellContent}}", cellContent)
						.replace("{{weekday}}", weekDay)
						.replace("{{dailyNote}}", dailyNotePath);
				}
				if (i < 0) cell = cell.replace("{{class}}", "prevMonth");
				else if (
					i >= 0 &&
					i < lastDateOfMonth &&
					tToday !== currentDate
				)
					cell = cell.replace("{{class}}", "currentMonth");
				else if (i >= 0 && i < lastDateOfMonth && tToday == currentDate)
					cell = cell.replace("{{class}}", "currentMonth today");
				else if (i >= lastDateOfMonth)
					cell = cell.replace("{{class}}", "nextMonth");
				wrapper += cell;
			}
			wrappers += `<div class='wrapper'><div class='wrapperButton' data-week='${weekNr}' data-year='${yearNr}'>W${weekNr}</div>${wrapper}</div>`;
			starts += 7;
		}
		gridContent += `<div class='gridHeads'><div class='gridHead'></div>${gridHeads}</div>`;
		gridContent += `<div class='wrappers' data-month='${window
			.moment(month)
			.format("MMM")
			.replace(".", "")
			.substring(0, 3)}'>${wrappers}</div>`;
		rootNode
			.querySelector("span")
			?.appendChild(dv.el("div", gridContent, { cls: "grid" }));
		setWrapperEvents();
		setStatisticValues(
			dueCounter,
			doneCounter,
			overdueCounter,
			startCounter,
			scheduledCounter,
			recurrenceCounter,
			dailyNoteCounter
		);
		rootNode.setAttribute("view", "month");

		if (dv.app.isMobile) {
			setTimeout(() => {
				rootNode
					.querySelectorAll("[data-task-text]")
					.forEach((el: any) => {
						let pressTimer: any = null;
						let longPress = false;
						el.addEventListener("contextmenu", (e: any) =>
							e.preventDefault()
						);
						el.style.userSelect = "none";
						el.style.webkitUserSelect = "none";
						el.style.webkitUserDrag = "none";
						el.style.touchAction = "manipulation";
						el.querySelectorAll?.("a").forEach((link: any) => {
							link.style.userSelect = "none";
							link.style.webkitUserSelect = "none";
							link.style.webkitUserDrag = "none";
							link.style.touchAction = "manipulation";
						});
						el.addEventListener("touchstart", function (e: any) {
							longPress = false;
							pressTimer = setTimeout(() => {
								longPress = true;
								alert(el.getAttribute("data-task-text"));
							}, 500);
						});
						el.addEventListener("touchend", function (e: any) {
							clearTimeout(pressTimer);
							if (longPress) {
								e.preventDefault();
								e.stopPropagation();
							}
						});
						el.addEventListener("touchmove", function () {
							clearTimeout(pressTimer);
						});
						el.addEventListener("touchcancel", function () {
							clearTimeout(pressTimer);
						});
						el.onclick = null;
					});
			}, 0);
		}

		const today = window.moment().format("YYYY-MM-DD");
		const overdueTasks = tasks.filter(
			(t) =>
				!t.completed &&
				!t.checked &&
				t.due &&
				window.moment(t.due).isBefore(today)
		);
		overdueCounter = overdueTasks.length;

		setTimeout(() => {
			rootNode
				.querySelectorAll(
					".cell.currentMonth, .cell.currentMonth.today"
				)
				.forEach((cell: HTMLElement) => {
					cell.addEventListener("click", (e) => {
						const target = e.target as HTMLElement;
						if (target.closest(".task")) return;
						if (target.closest(".cellName")) return;
						const date =
							cell
								.querySelector("a.cellName")
								?.getAttribute("href")
								?.split("/")
								.pop() || "";
						if (date) addTaskToDate(dv, date);
					});
				});
		}, 0);
	}

	function getWeek(tasks: any[], week: any) {
		removeExistingView();
		const currentTitle = `<span>${window
			.moment(week)
			.format("YYYY")}</span><span> ${window
			.moment(week)
			.format("[W]w")}</span>`;
		rootNode.querySelector("button.current").innerHTML = currentTitle;
		let gridContent = "";
		const currentWeekday = parseInt(window.moment(week).format("d"));
		let dueCounter = 0,
			doneCounter = 0,
			overdueCounter = 0,
			startCounter = 0,
			scheduledCounter = 0,
			recurrenceCounter = 0,
			dailyNoteCounter = 0;
		for (
			let i = 0 - currentWeekday + parseInt(firstDayOfWeek);
			i < 7 - currentWeekday + parseInt(firstDayOfWeek);
			i++
		) {
			const currentDate = window
				.moment(week)
				.add(i, "days")
				.format("YYYY-MM-DD");
			const stats = getTasksForDate(tasks, currentDate);
			dueCounter += stats.due.length;
			doneCounter += stats.allDone.length;
			startCounter += stats.start.length;
			scheduledCounter += stats.scheduled.length;
			recurrenceCounter += stats.recurrence.length;
			dailyNoteCounter += stats.dailyNote.length;
			const dailyNotePath = dailyNoteFolder
				? `${dailyNoteFolder}/${currentDate}`
				: currentDate;
			const weekDay = window.moment(week).add(i, "days").format("d");
			const longDayName = window
				.moment(currentDate)
				.format("ddd, D. MMM");
			const cellContent = setTaskContentContainer(currentDate, tasks);
			let cell = cellTemplate
				.replace("{{date}}", currentDate)
				.replace("{{cellName}}", longDayName)
				.replace("{{cellContent}}", cellContent)
				.replace("{{weekday}}", weekDay)
				.replace("{{dailyNote}}", dailyNotePath);
			cell = cell.replace("{{class}}", "currentWeek");
			gridContent += cell;
		}
		rootNode
			.querySelector("span")
			?.appendChild(dv.el("div", gridContent, { cls: "grid" }));
		setStatisticValues(
			dueCounter,
			doneCounter,
			overdueCounter,
			startCounter,
			scheduledCounter,
			recurrenceCounter,
			dailyNoteCounter
		);
		rootNode.setAttribute("view", "week");

		if (dv.app.isMobile) {
			setTimeout(() => {
				rootNode
					.querySelectorAll("[data-task-text]")
					.forEach((el: any) => {
						let pressTimer: any = null;
						let longPress = false;
						el.addEventListener("contextmenu", (e: any) =>
							e.preventDefault()
						);
						el.style.userSelect = "none";
						el.style.webkitUserSelect = "none";
						el.style.webkitUserDrag = "none";
						el.style.touchAction = "manipulation";
						el.querySelectorAll?.("a").forEach((link: any) => {
							link.style.userSelect = "none";
							link.style.webkitUserSelect = "none";
							link.style.webkitUserDrag = "none";
							link.style.touchAction = "manipulation";
						});
						el.addEventListener("touchstart", function (e: any) {
							longPress = false;
							pressTimer = setTimeout(() => {
								longPress = true;
								alert(el.getAttribute("data-task-text"));
							}, 500);
						});
						el.addEventListener("touchend", function (e: any) {
							clearTimeout(pressTimer);
							if (longPress) {
								e.preventDefault();
								e.stopPropagation();
							}
						});
						el.addEventListener("touchmove", function () {
							clearTimeout(pressTimer);
						});
						el.addEventListener("touchcancel", function () {
							clearTimeout(pressTimer);
						});
						el.onclick = null;
					});
			}, 0);
		}

		setTimeout(() => {
			rootNode
				.querySelectorAll(".cell.currentWeek")
				.forEach((cell: HTMLElement) => {
					cell.addEventListener("click", (e) => {
						const target = e.target as HTMLElement;
						if (target.closest(".task")) return;
						if (target.closest(".cellName")) return;
						const date =
							cell
								.querySelector("a.cellName")
								?.getAttribute("href")
								?.split("/")
								.pop() || "";
						if (date) addTaskToDate(dv, date);
					});
				});
		}, 0);
	}

	function getList(tasks: any[], month: any) {
		removeExistingView();
		const currentTitle = `<span>${window
			.moment(month)
			.format("MMMM")}</span><span> ${window
			.moment(month)
			.format("YYYY")}</span>`;
		rootNode.querySelector("button.current").innerHTML = currentTitle;
		let gridContent = "";
		let dueCounter = 0,
			doneCounter = 0,
			overdueCounter = 0,
			startCounter = 0,
			scheduledCounter = 0,
			recurrenceCounter = 0,
			dailyNoteCounter = 0;
		for (let i = 1; i <= 31; i++) {
			const currentDate = window
				.moment(month)
				.date(i)
				.format("YYYY-MM-DD");
			const stats = getTasksForDate(tasks, currentDate);
			dueCounter += stats.due.length;
			doneCounter += stats.allDone.length;
			startCounter += stats.start.length;
			scheduledCounter += stats.scheduled.length;
			recurrenceCounter += stats.recurrence.length;
			dailyNoteCounter += stats.dailyNote.length;
			const cellContent = setTaskContentContainer(currentDate, tasks);
			if (cellContent) {
				gridContent += `<div class='listItem'><span class='listDate'>${currentDate}</span><div class='listContent'>${cellContent}</div></div>`;
			}
		}
		rootNode
			.querySelector("span")
			?.appendChild(dv.el("div", gridContent, { cls: "grid" }));
		setStatisticValues(
			dueCounter,
			doneCounter,
			overdueCounter,
			startCounter,
			scheduledCounter,
			recurrenceCounter,
			dailyNoteCounter
		);
		rootNode.setAttribute("view", "list");

		if (dv.app.isMobile) {
			setTimeout(() => {
				rootNode
					.querySelectorAll("[data-task-text]")
					.forEach((el: any) => {
						let pressTimer: any = null;
						let longPress = false;
						el.addEventListener("contextmenu", (e: any) =>
							e.preventDefault()
						);
						el.style.userSelect = "none";
						el.style.webkitUserSelect = "none";
						el.style.webkitUserDrag = "none";
						el.style.touchAction = "manipulation";
						el.querySelectorAll?.("a").forEach((link: any) => {
							link.style.userSelect = "none";
							link.style.webkitUserSelect = "none";
							link.style.webkitUserDrag = "none";
							link.style.touchAction = "manipulation";
						});
						el.addEventListener("touchstart", function (e: any) {
							longPress = false;
							pressTimer = setTimeout(() => {
								longPress = true;
								alert(el.getAttribute("data-task-text"));
							}, 500);
						});
						el.addEventListener("touchend", function (e: any) {
							clearTimeout(pressTimer);
							if (longPress) {
								e.preventDefault();
								e.stopPropagation();
							}
						});
						el.addEventListener("touchmove", function () {
							clearTimeout(pressTimer);
						});
						el.addEventListener("touchcancel", function () {
							clearTimeout(pressTimer);
						});
						el.onclick = null;
					});
			}, 0);
		}

		setTimeout(() => {
			rootNode
				.querySelectorAll(".listDate")
				.forEach((dateEl: HTMLElement) => {
					dateEl.addEventListener("click", () => {
						const date = dateEl.textContent?.trim() || "";
						if (date) addTaskToDate(dv, date);
					});
				});
		}, 0);
	}

	// --- Start rendering by view ---
	if (view === "month") {
		getMonth(tasks, selectedDate);
	} else if (view === "week") {
		getWeek(tasks, selectedDate);
	} else if (view === "list") {
		getList(tasks, selectedDate);
	}

	// After rendering, attach event listeners to checkboxes
	setTimeout(() => {
		rootNode
			.querySelectorAll(".calendar-task-checkbox")
			.forEach((checkbox: HTMLInputElement) => {
				checkbox.addEventListener("change", async (e: Event) => {
					const cb = e.target as HTMLInputElement;
					const filePath = cb.getAttribute("data-task-path");
					const lineNum = parseInt(
						cb.getAttribute("data-task-line") || "0",
						10
					);
					if (!filePath || isNaN(lineNum)) return;
					// Get the file from the vault
					const file = dv.app.vault.getAbstractFileByPath(filePath);
					// Check for file existence and required properties
					if (!file || !file.path || !file.stat) return;
					// Read file content
					const content = await dv.app.vault.read(file);
					const lines = content.split("\n");
					// Update the checkbox state at the correct line
					if (!lines[lineNum]) return;
					// Get today's date in YYYY-MM-DD format using moment.js
					const today = window.moment().format("YYYY-MM-DD");
					if (cb.checked) {
						// If checked, ensure '✅ YYYY-MM-DD' is at the end (if not already)
						if (!/✅ \d{4}-\d{2}-\d{2}$/.test(lines[lineNum])) {
							lines[lineNum] = lines[lineNum].replace(
								/\s*✅ \d{4}-\d{2}-\d{2}$/,
								""
							);
							lines[lineNum] += ` ✅ ${today}`;
						}
					} else {
						// If unchecked, remove any '✅ YYYY-MM-DD' at the end
						lines[lineNum] = lines[lineNum].replace(
							/\s*✅ \d{4}-\d{2}-\d{2}$/,
							""
						);
					}
					// Also update the checkbox state at the start
					lines[lineNum] = lines[lineNum].replace(
						/^- \[[ xX]\]/,
						cb.checked ? "- [x]" : "- [ ]"
					);
					// Write the updated content back to the file
					await dv.app.vault.modify(file, lines.join("\n"));
				});
			});
	}, 0);
}

function transColor(color: string, percent: number): string {
	const num = parseInt(color.replace("#", ""), 16);
	const amt = Math.round(2.55 * percent);
	const R = (num >> 16) + amt;
	const B = ((num >> 8) & 0x00ff) + amt;
	const G = (num & 0x0000ff) + amt;
	return (
		"#" +
		(
			0x1000000 +
			(R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
			(B < 255 ? (B < 1 ? 0 : B) : 255) * 0x100 +
			(G < 255 ? (G < 1 ? 0 : G) : 255)
		)
			.toString(16)
			.slice(1)
	);
}

class TaskInputModal extends Modal {
	taskText: string = "";
	onSubmit: (result: string) => void;
	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.style.display = "block";
		contentEl.style.padding = "16px 20px 12px 20px";

		const form = contentEl.createEl("div");
		form.style.display = "flex";
		form.style.flexDirection = "row";
		form.style.alignItems = "center";
		form.style.gap = "10px";
		form.style.width = "100%";
		form.style.maxWidth = "420px";
		form.style.margin = "0 auto";

		const input = form.createEl("input", {
			type: "text",
			placeholder: "Task description",
		});
		input.style.padding = "8px 12px";
		input.style.fontSize = "1.05em";
		input.style.border = "1px solid var(--interactive-accent)";
		input.style.borderRadius = "6px";
		input.style.background = "var(--background-secondary)";
		input.style.color = "var(--text-normal)";
		input.style.outline = "none";
		input.style.flex = "1 1 auto";
		input.style.minWidth = "0";
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.taskText = input.value;
				this.close();
				this.onSubmit(this.taskText);
			}
		});
		input.focus();

		const button = form.createEl("button", { text: "Add" });
		button.style.padding = "8px 16px";
		button.style.fontSize = "1.05em";
		button.style.border = "none";
		button.style.borderRadius = "6px";
		button.style.background = "var(--interactive-accent)";
		button.style.color = "var(--text-on-accent)";
		button.style.cursor = "pointer";
		button.style.transition = "background 0.2s";
		button.style.flex = "0 0 auto";
		button.onmouseenter = () =>
			(button.style.background = "var(--interactive-accent-hover)");
		button.onmouseleave = () =>
			(button.style.background = "var(--interactive-accent)");
		button.onclick = () => {
			this.taskText = input.value;
			this.close();
			this.onSubmit(this.taskText);
		};
	}
	onClose() {
		this.contentEl.empty();
	}
}

function addTaskToDate(dv: any, clickedDate: string) {
	const settings = (window as any).calendarPluginSettings || DEFAULT_SETTINGS;
	const today = window.moment().format("YYYY-MM-DD");
	new TaskInputModal(dv.app, async (taskText: string) => {
		if (!taskText || !taskText.trim()) return;
		const prefix = settings.taskPrefix ? settings.taskPrefix.trim() : "";
		const taskLine = `- [ ] ${prefix} ${taskText} 📅 ${clickedDate}`;
		let file: TFile | null = null;
		let filePath = "";
		if (settings.addToToday) {
			const periodicNotes = dv.app.plugins.plugins["periodic-notes"];
			const pnSettings = periodicNotes?.settings;
			const folder = pnSettings?.daily?.folder || "periodic/daily";
			const format = pnSettings?.daily?.format || "YYYY-MM-DD";
			const fileName = dv.app.internalPlugins.plugins["periodic-notes"]
				?.instance?.options?.daily?.format
				? window
						.moment(today)
						.format(
							dv.app.internalPlugins.plugins["periodic-notes"]
								.instance.options.daily.format
						)
				: window.moment(today).format(format);
			filePath = `${folder}/${fileName}.md`;
			file = dv.app.vault.getAbstractFileByPath(filePath) as TFile;
			if (!file) {
				await dv.app.commands.executeCommandById(
					"periodic-notes:open-daily-note"
				);
				await new Promise((resolve) => setTimeout(resolve, 1500));
				let tryCount = 0;
				while (!file && tryCount < 10) {
					await new Promise((resolve) => setTimeout(resolve, 200));
					file = dv.app.vault.getAbstractFileByPath(
						filePath
					) as TFile;
					tryCount++;
				}
				if (!file) {
					new Notice("Could not find or create the daily note.");
					return;
				}
			}
		} else if (settings.customFilePath) {
			filePath = settings.customFilePath;
			file = dv.app.vault.getAbstractFileByPath(filePath) as TFile;
			if (!file) {
				await dv.app.vault.create(filePath, "");
				file = dv.app.vault.getAbstractFileByPath(filePath) as TFile;
			}
		}
		if (!file) {
			new Notice("No file selected for task addition.");
			return;
		}
		const content = await dv.app.vault.read(file);
		await dv.app.vault.modify(file, content + "\n" + taskLine);
		new Notice("Task added to " + file.name);
	}).open();
}
