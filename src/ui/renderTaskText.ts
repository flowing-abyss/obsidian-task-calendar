import { Component, MarkdownRenderer, Menu, MenuItem, type App } from 'obsidian';
import { pairAnchorsToTokens, parseLinks, type LinkToken } from '../parser/links';

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
  // Link click navigates; never bubble to the card/row handler.
  anchors.forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  if (!opts.onEditLink) return;
  const tokens = parseLinks(markdownText);
  const descriptors = anchors.map((a) => ({
    text: a.textContent ?? '',
    href: a.getAttribute('data-href') ?? a.getAttribute('href') ?? '',
  }));
  const occurrences = pairAnchorsToTokens(descriptors, tokens);
  anchors.forEach((a, i) => {
    const occurrenceIndex = occurrences[i]!;
    if (occurrenceIndex < 0) return;
    const token = tokens[occurrenceIndex]!;
    a.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = new Menu();
      menu.addItem(buildEditLinkItem(occurrenceIndex, token, opts));
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
