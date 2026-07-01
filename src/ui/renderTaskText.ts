import { Component, MarkdownRenderer, Menu, MenuItem, type App } from 'obsidian';
import { parseLinks, type LinkToken } from '../parser/links';

export interface RenderTaskTextOptions {
  app: App;
  sourcePath: string;
  component: Component;
  onEditLink?: (occurrenceIndex: number, token: LinkToken) => void;
}

export function renderTaskText(
  el: HTMLElement,
  markdownText: string,
  opts: RenderTaskTextOptions,
): void {
  el.empty();
  const holder = el.createSpan({ cls: 'tc-md' });
  void MarkdownRenderer.render(opts.app, markdownText, holder, opts.sourcePath, opts.component);
  // Unwrap the single wrapping <p> MarkdownRenderer emits so titles stay inline.
  window.setTimeout(() => {
    const p = holder.querySelector(':scope > p');
    if (p && holder.childElementCount === 1) {
      while (p.firstChild) holder.appendChild(p.firstChild);
      p.remove();
    }
    wireLinks(holder, markdownText, opts);
  }, 0);
}

function wireLinks(holder: HTMLElement, markdownText: string, opts: RenderTaskTextOptions): void {
  const anchors = Array.from(holder.querySelectorAll('a'));
  const tokens = parseLinks(markdownText);
  anchors.forEach((a, i) => {
    // Link click navigates; never bubble to the card/row handler.
    a.addEventListener('click', (e) => e.stopPropagation());
    const token = tokens[i];
    if (!token || !opts.onEditLink) return;
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = new Menu();
      menu.addItem(buildEditLinkItem(i, token, opts));
      menu.showAtMouseEvent(e);
    });
  });
}

function buildEditLinkItem(
  occurrenceIndex: number,
  token: LinkToken,
  opts: RenderTaskTextOptions,
): (item: MenuItem) => void {
  return (item: MenuItem) =>
    item
      .setTitle('Edit link…')
      .setIcon('pencil')
      .onClick(() => opts.onEditLink!(occurrenceIndex, token));
}
