import { Modal, type App } from 'obsidian';

/** Prompts for a project name; calls `onSubmit(name)` once for a non-empty name. */
export class CreateProjectModal extends Modal {
  private input!: HTMLInputElement;
  private submitted = false;

  constructor(
    app: App,
    private onSubmit: (name: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'New project' });

    this.input = contentEl.createEl('input', {
      cls: 'tc-create-project-input',
      attr: { type: 'text', placeholder: 'Project name…' },
    });

    const btnRow = contentEl.createDiv({ cls: 'tc-create-project-btn-row' });
    const okBtn = btnRow.createEl('button', { text: 'Create', cls: 'mod-cta' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });

    okBtn.addEventListener('click', () => this.submit(this.input.value));
    cancelBtn.addEventListener('click', () => this.close());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit(this.input.value);
      }
      if (e.key === 'Escape') this.close();
    });
    window.setTimeout(() => this.input.focus(), 0);
  }

  /** Extracted for testability: fires onSubmit once for a non-empty name, then closes. */
  submit(value: string): void {
    if (this.submitted) return;
    const name = value.trim();
    if (!name) return;
    this.submitted = true;
    this.onSubmit(name);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
