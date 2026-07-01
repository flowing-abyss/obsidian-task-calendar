import { Component, Keymap, MarkdownRenderer, Menu, MenuItem, type App } from 'obsidian';
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
  // Link click navigates; never bubble to the card/row handler. Obsidian's global
  // internal-link handler is bypassed by stopPropagation, so open the note ourselves.
  anchors.forEach((a) => {
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!a.hasClass('internal-link')) return; // external links keep their default nav
      e.preventDefault();
      const href = a.getAttribute('data-href') ?? a.getAttribute('href') ?? '';
      if (href) void opts.app.workspace.openLinkText(href, opts.sourcePath, Keymap.isModEvent(e));
    });
    // Arm Obsidian's page-preview (hover) popover for internal links.
    a.addEventListener('mouseover', (e) => {
      if (!a.hasClass('internal-link')) return;
      const href = a.getAttribute('data-href') ?? '';
      if (href) {
        opts.app.workspace.trigger('hover-link', {
          event: e,
          source: 'task-calendar',
          hoverParent: holder,
          targetEl: a,
          linktext: href,
          sourcePath: opts.sourcePath,
        });
      }
    });
  });
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
