import { App, Modal } from 'obsidian';
import { I18n } from './i18n';

export class CreateListModal extends Modal {
  constructor(app: App, private readonly i18n: I18n, private readonly initialPath: string,
    private readonly create: (path: string) => Promise<void>) { super(app); }

  onOpen(): void {
    this.titleEl.setText(this.i18n.t('commandCreateList'));
    this.modalEl.addClass('zadachi-modal', 'zadachi-edit-modal');
    this.contentEl.empty();
    const form = this.contentEl.createEl('form', { cls: 'zadachi-edit-form' });
    const label = form.createEl('label', { cls: 'zadachi-field-label', text: this.i18n.t('listPathLabel') });
    const path = label.createEl('input', { cls: 'zadachi-edit-title', attr: { type: 'text' } });
    path.required = true;
    path.value = this.initialPath;
    form.createDiv({ cls: 'zadachi-list-path-hint', text: this.i18n.t('listPathHint') });
    const error = form.createDiv({ cls: 'zadachi-form-error', attr: { role: 'alert' } });
    const actions = form.createDiv('zadachi-modal-actions');
    const cancel = actions.createEl('button', { attr: { type: 'button' }, text: this.i18n.t('cancel') });
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { attr: { type: 'submit' }, cls: 'mod-cta', text: this.i18n.t('createList') });
    let saving = false;
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (saving) return;
      const entered = path.value.trim();
      if (!entered) { path.focus(); return; }
      const value = /\.md$/i.test(entered) ? entered : `${entered}.md`;
      saving = true;
      error.textContent = '';
      for (const control of [path, cancel, save]) control.disabled = true;
      void this.create(value).then(() => this.close()).catch(reason => {
        error.textContent = this.i18n.error(reason, 'createListFailed');
      }).finally(() => {
        saving = false;
        for (const control of [path, cancel, save]) control.disabled = false;
      });
    });
    path.focus();
    path.select();
  }
}
