import { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import { CalendarSettingsTab } from '../src/settings/SettingsTab';
import type { CalendarSettings } from '../src/settings/types';

interface StubPlugin {
  app: App;
  settings: CalendarSettings;
  saveSettings(): Promise<void>;
}

function makeTab(): CalendarSettingsTab {
  const app = new App();
  const plugin: StubPlugin = {
    app,
    settings: structuredClone(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockResolvedValue(undefined),
  };
  const tab = new CalendarSettingsTab(
    app,
    plugin as unknown as ConstructorParameters<typeof CalendarSettingsTab>[1],
  );
  tab.display();
  return tab;
}

describe('CalendarSettingsTab sections', () => {
  it('renders exactly 4 sections', () => {
    const tab = makeTab();
    const sections = tab.containerEl.querySelectorAll('.tc-settings-section');
    expect(sections).toHaveLength(4);
  });

  it('all sections start collapsed (no is-open)', () => {
    const tab = makeTab();
    const open = tab.containerEl.querySelectorAll('.tc-settings-section.is-open');
    expect(open).toHaveLength(0);
  });

  it('clicking a header adds is-open to that section', () => {
    const tab = makeTab();
    const header = tab.containerEl.querySelector<HTMLElement>('.tc-settings-section-header');
    expect(header).not.toBeNull();
    header!.click();
    const section = header!.closest('.tc-settings-section');
    expect(section?.classList.contains('is-open')).toBe(true);
  });

  it('clicking header again removes is-open', () => {
    const tab = makeTab();
    const header = tab.containerEl.querySelector<HTMLElement>('.tc-settings-section-header');
    header!.click();
    header!.click();
    const section = header!.closest('.tc-settings-section');
    expect(section?.classList.contains('is-open')).toBe(false);
  });

  it('section labels match expected names', () => {
    const tab = makeTab();
    const labels = Array.from(tab.containerEl.querySelectorAll('.tc-settings-section-label')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['General', 'Desktop', 'Mobile', 'Tag groups']);
  });

  it('each section header has an icon element', () => {
    const tab = makeTab();
    const icons = tab.containerEl.querySelectorAll('.tc-settings-section-icon');
    expect(icons).toHaveLength(4);
  });

  it('each section header has a chevron element', () => {
    const tab = makeTab();
    const chevrons = tab.containerEl.querySelectorAll('.tc-settings-section-chevron');
    expect(chevrons).toHaveLength(4);
  });
});
