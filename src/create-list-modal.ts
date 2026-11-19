import { App, Modal } from 'obsidian';
import { I18n } from './i18n';

export class CreateListModal extends Modal {
  constructor(app: App, private readonly i18n: I18n, private readonly initialPath: string,
    private readonly create: (path: string) => Promise<void>) { super(app); }

  onOpen(): void {
    this.titleEl.setText(this.i18n.t('commandCreateList'));
    this.modalEl.addClass('zadachi-modal', 'zadachi-edit-modal');
    this.contentEl.empty();
    const form = document.createElement('form');
    form.className = 'zadachi-edit-form';
    const label = document.createElement('label');
    label.className = 'zadachi-field-label';
    label.textContent = this.i18n.t('listPathLabel');
    const path = document.createElement('input');
    path.className = 'zadachi-edit-title';
    path.type = 'text';
    path.required = true;
    path.value = this.initialPath;
    label.appendChild(path);
    const hint = document.createElement('div');
    hint.className = 'zadachi-list-path-hint';
    hint.textContent = this.i18n.t('listPathHint');
    const error = document.createElement('div');
    error.className = 'zadachi-form-error';
    error.setAttribute('role', 'alert');
    const actions = document.createElement('div');
    actions.className = 'zadachi-modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = this.i18n.t('cancel');
    cancel.addEventListener('click', () => this.close());
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'mod-cta';
    save.textContent = this.i18n.t('createList');
    actions.append(cancel, save);
    form.append(label, hint, error, actions);
    this.contentEl.appendChild(form);
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
