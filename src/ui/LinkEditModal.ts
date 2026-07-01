import { App, Modal, Setting } from 'obsidian';
import { buildLinkRaw, type LinkToken } from '../parser/links';

export class LinkEditModal extends Modal {
  private display: string;
  private target: string;

  constructor(
    app: App,
    private token: LinkToken,
    private onSave: (newRaw: string) => void,
  ) {
    super(app);
    this.display = token.display;
    this.target = token.target;
  }

  onOpen(): void {
    const { contentEl, token } = this;
    contentEl.createEl('h3', { text: token.type === 'wiki' ? 'Edit wiki link' : 'Edit link' });

    new Setting(contentEl)
      .setName(token.type === 'wiki' ? 'Note' : 'URL')
      .addText((t) =>
        t.setValue(this.target).onChange((v) => {
          this.target = v;
        }),
      );

    new Setting(contentEl)
      .setName(token.type === 'wiki' ? 'Display (alias)' : 'Display text')
      .addText((t) =>
        t.setValue(this.display).onChange((v) => {
          this.display = v;
        }),
      );

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText('Save')
        .setCta()
        .onClick(() => {
          this.onSave(buildLinkRaw(token.type, this.target.trim(), this.display.trim()));
          this.close();
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
