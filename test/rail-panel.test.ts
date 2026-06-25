import { describe, expect, it, vi } from 'vitest';
import { AppState } from '../src/app/AppState';
import { RailPanel } from '../src/panels/RailPanel';
import { freshContainer } from './helpers';

describe('RailPanel', () => {
  it('renders 3 mode buttons + 1 settings button', () => {
    const state = new AppState();
    const app = { setting: { open: vi.fn(), openTabById: vi.fn() } };
    const panel = new RailPanel(state, app);
    panel.mount(freshContainer());
    const buttons = panel['el'].querySelectorAll('button');
    expect(buttons).toHaveLength(4);
  });

  it('mode buttons have correct aria-labels', () => {
    const state = new AppState();
    const panel = new RailPanel(state, { setting: {} });
    panel.mount(freshContainer());
    const labels = Array.from(panel['el'].querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Tasks', 'Calendar', 'Search', 'Settings']);
  });

  it('active mode button has is-active class', () => {
    const state = new AppState();
    state.set('mode', 'calendar');
    const panel = new RailPanel(state, { setting: {} });
    panel.mount(freshContainer());
    const active = panel['el'].querySelector('.tc-rail-btn.is-active');
    expect(active?.getAttribute('aria-label')).toBe('Calendar');
  });

  it('click Tasks button sets mode to tasks', () => {
    const state = new AppState();
    state.set('mode', 'calendar');
    const panel = new RailPanel(state, { setting: {} });
    panel.mount(freshContainer());
    const btn = Array.from(panel['el'].querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Tasks')!;
    btn.click();
    expect(state.get('mode')).toBe('tasks');
  });

  it('click Calendar button sets mode to calendar', () => {
    const state = new AppState();
    const panel = new RailPanel(state, { setting: {} });
    panel.mount(freshContainer());
    const btn = Array.from(panel['el'].querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Calendar')!;
    btn.click();
    expect(state.get('mode')).toBe('calendar');
  });

  it('click Search button sets mode to search', () => {
    const state = new AppState();
    const panel = new RailPanel(state, { setting: {} });
    panel.mount(freshContainer());
    const btn = Array.from(panel['el'].querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Search')!;
    btn.click();
    expect(state.get('mode')).toBe('search');
  });

  it('state change re-renders active class', () => {
    const state = new AppState();
    const panel = new RailPanel(state, { setting: {} });
    panel.mount(freshContainer());
    state.set('mode', 'search');
    const active = panel['el'].querySelector('.tc-rail-btn.is-active');
    expect(active?.getAttribute('aria-label')).toBe('Search');
  });

  it('click Settings calls app.setting.open', () => {
    const state = new AppState();
    const open = vi.fn();
    const openTabById = vi.fn();
    const panel = new RailPanel(state, { setting: { open, openTabById } });
    panel.mount(freshContainer());
    const btn = Array.from(panel['el'].querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Settings')!;
    btn.click();
    expect(open).toHaveBeenCalledOnce();
  });

  it('click Settings calls openTabById with task-calendar', () => {
    const state = new AppState();
    const openTabById = vi.fn();
    const panel = new RailPanel(state, { setting: { open: vi.fn(), openTabById } });
    panel.mount(freshContainer());
    const btn = Array.from(panel['el'].querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Settings')!;
    btn.click();
    expect(openTabById).toHaveBeenCalledWith('task-calendar');
  });

  it('settings button click with undefined setting does not throw', () => {
    const state = new AppState();
    const panel = new RailPanel(state, { setting: undefined });
    panel.mount(freshContainer());
    const btn = Array.from(panel['el'].querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Settings')!;
    expect(() => btn.click()).not.toThrow();
  });

  it('destroy removes state listener (no re-render after)', () => {
    const state = new AppState();
    const panel = new RailPanel(state, { setting: {} });
    panel.mount(freshContainer());
    panel.destroy();
    const el = panel['el'];
    state.set('mode', 'search');
    // el is emptied but no new buttons rendered
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });

  it('destroy empties el', () => {
    const state = new AppState();
    const panel = new RailPanel(state, { setting: {} });
    panel.mount(freshContainer());
    panel.destroy();
    expect(panel['el'].children).toHaveLength(0);
  });
});