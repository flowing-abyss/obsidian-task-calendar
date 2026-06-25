import { Modal, type App } from 'obsidian';
import type { TagManager } from './TagManager';

export class RenameTagModal extends Modal {
  private input!: HTMLInputElement;

  constructor(
    app: App,
    private tagManager: TagManager,
    private currentTag: string,
    private onRenamed: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Rename tag' });

    this.input = contentEl.createEl('input', {
      cls: 'tc-rename-input',
      attr: { type: 'text', value: this.currentTag },
    });
    this.input.select();

    const btnRow = contentEl.createDiv({ cls: 'tc-rename-btn-row' });
    const okBtn = btnRow.createEl('button', { text: 'Rename', cls: 'mod-cta' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });

    const doRename = (): void => {
      const newTag = this.input.value.trim();
      if (!newTag || newTag === this.currentTag) {
        this.close();
        return;
      }
      void this.tagManager.renameTag(this.currentTag, newTag).then(() => {
        this.onRenamed();
        this.close();
      });
    };

    okBtn.addEventListener('click', doRename);
    cancelBtn.addEventListener('click', () => this.close());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doRename();
      if (e.key === 'Escape') this.close();
    });

    window.setTimeout(() => this.input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
