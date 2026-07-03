import { Menu, setIcon } from 'obsidian';
import { orderedGroups, type StatusGroup } from '../../projects/status';
import type { Project } from '../../projects/types';
import type { ProjectStatus } from '../../settings/types';
import { renderProgressBar } from './progressBar';
import type { ProjectsListContext } from './viewContext';

function projectsInGroup(group: StatusGroup, projects: Project[]): Project[] {
  if (group.statusId !== null) return projects.filter((p) => p.statusId === group.statusId);
  if (group.key.startsWith('raw:')) {
    return projects.filter((p) => p.statusId === null && p.rawStatus === group.label);
  }
  return projects.filter((p) => p.statusId === null && p.rawStatus === null);
}

function parentFolder(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/** Overview: all projects grouped by status (defined order → discovered → No status). */
export function renderProjectsList(
  container: HTMLElement,
  projects: Project[],
  ctx: ProjectsListContext,
): void {
  container.addClass('tc-projects-list');

  const header = container.createDiv({ cls: 'tc-projects-toolbar' });
  header.createEl('h2', { cls: 'tc-projects-title', text: 'Projects' });
  const newBtn = header.createEl('button', { cls: 'tc-projects-new', text: 'New project' });
  newBtn.addEventListener('click', () => ctx.onNew());

  const statuses = ctx.settings.projects.statuses;
  const statusById = new Map(statuses.map((s) => [s.id, s]));

  // Names appearing more than once → disambiguate rows with their folder.
  const nameCounts = new Map<string, number>();
  for (const p of projects) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);

  const scroll = container.createDiv({ cls: 'tc-projects-scroll' });

  if (projects.length === 0) {
    scroll.createDiv({ cls: 'tc-projects-empty', text: 'No projects yet' });
    return;
  }

  for (const group of orderedGroups(statuses, projects)) {
    const inGroup = projectsInGroup(group, projects);
    if (inGroup.length === 0) continue;

    const groupEl = scroll.createDiv({ cls: 'tc-projects-group' });
    const gHeader = groupEl.createDiv({ cls: 'tc-projects-group-header' });
    if (group.color) {
      const dot = gHeader.createSpan({ cls: 'tc-status-dot' });
      dot.style.background = group.color;
    }
    gHeader.createSpan({ cls: 'tc-projects-group-label', text: group.label });
    gHeader.createSpan({ cls: 'tc-projects-group-count', text: String(inGroup.length) });

    for (const project of inGroup) {
      renderRow(groupEl, project, statusById, statuses, nameCounts, ctx);
    }
  }
}

function renderRow(
  parent: HTMLElement,
  project: Project,
  statusById: Map<string, ProjectStatus>,
  statuses: ProjectStatus[],
  nameCounts: Map<string, number>,
  ctx: ProjectsListContext,
): void {
  const row = parent.createDiv({ cls: 'tc-project-row' });

  const status = project.statusId ? statusById.get(project.statusId) : undefined;
  const dot = row.createSpan({ cls: 'tc-status-dot' });
  if (status?.color) dot.style.background = status.color;

  const nameWrap = row.createDiv({ cls: 'tc-project-row-name' });
  nameWrap.createSpan({ cls: 'tc-project-name', text: project.name });
  if ((nameCounts.get(project.name) ?? 0) > 1) {
    nameWrap.createSpan({ cls: 'tc-project-folder', text: parentFolder(project.path) });
  }

  renderProgressBar(row, project.stats.done, project.stats.total);

  const actions = row.createDiv({ cls: 'tc-project-row-actions' });

  const statusBtn = actions.createEl('button', {
    cls: 'tc-project-status-btn',
    attr: { 'aria-label': 'Change status' },
  });
  setIcon(statusBtn, 'circle-dot');
  statusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = new Menu();
    for (const s of statuses) {
      menu.addItem((item) =>
        item
          .setTitle(s.label)
          .setChecked(s.id === project.statusId)
          .onClick(() => ctx.onSetStatus(project.path, s.id)),
      );
    }
    menu.showAtMouseEvent(e);
  });

  const openBtn = actions.createEl('button', {
    cls: 'tc-project-open-btn',
    attr: { 'aria-label': 'Open note' },
  });
  setIcon(openBtn, 'file-text');
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.openNote(project.path);
  });

  row.addEventListener('click', () => {
    ctx.state.set('projectsPanel', { view: 'dashboard', path: project.path });
  });
}
