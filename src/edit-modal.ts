import { App, Modal, Notice } from 'obsidian';
import { I18n, LocalizedError } from './i18n';
import type { Task, TaskDraft, TaskService } from './types';
import { createPriorityToggle } from './priority-toggle';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Editing a snapshot lets the store detect a concurrent edit before saving. */
export class TaskEditModal extends Modal {
  private saving = false;
  private readonly taskPath: string;
  private unsubLocale: (() => void) | null = null;

  constructor(app: App, private readonly service: TaskService, private readonly task: Task, private readonly i18n = new I18n('ru'), private readonly onDismiss: () => void = () => {}) {
    super(app);
    this.taskPath = service.getPath();
  }

  onOpen(): void {
    this.titleEl.setText(this.i18n.t('editTitle'));
    this.contentEl.empty();
    this.modalEl.addClass('zadachi-modal', 'zadachi-edit-modal');

    const form = element('form', 'zadachi-edit-form');
    const titleLabel = element('label', 'zadachi-field-label', this.i18n.t('title'));
    const title = element('input', 'zadachi-edit-title');
    title.type = 'text';
    title.required = true;
    title.value = this.task.title;
    title.setAttribute('aria-label', this.i18n.t('taskTitle'));
    titleLabel.appendChild(title);

    const noteLabel = element('label', 'zadachi-field-label', this.i18n.t('noteOptional'));
    const note = element('textarea', 'zadachi-edit-note');
    note.value = this.task.note;
    note.rows = 6;
    note.placeholder = this.i18n.t('notePlaceholder');
    note.setAttribute('aria-label', this.i18n.t('note'));
    noteLabel.appendChild(note);

    const flags = element('div', 'zadachi-edit-flags');
    const urgent = createPriorityToggle('urgent', this.i18n.t('urgent'), this.task.urgent);
    const important = createPriorityToggle('important', this.i18n.t('important'), this.task.important);
    flags.append(urgent.button, important.button);
    const priority = element('div', 'zadachi-priority-field');
    priority.setAttribute('role', 'group');
    priority.setAttribute('aria-label', this.i18n.t('priority'));
    const priorityLabel = element('div', 'zadachi-field-label', this.i18n.t('priority'));
    priority.append(priorityLabel, flags);

    // Render links as text and explicit user-initiated navigation only.
    // Never render Markdown HTML or embedded images, which could load remote resources.
    const links = element('div', 'zadachi-note-links');
    links.setAttribute('aria-label', this.i18n.t('noteLinks'));
    const updateLinks = () => {
      links.replaceChildren();
      const pattern = /\[\[([^\]\n]+)\]\]|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)/g;
      const seen = new Set<string>();
      for (const match of note.value.matchAll(pattern)) {
        const target = match[1] ?? match[3] ?? match[4];
        if (seen.has(target)) continue;
        seen.add(target);
        const link = element('a', 'zadachi-note-link', match[1] ? (match[1].split('|')[1] || match[1]) : (match[2] || target));
        if (match[1]) {
          const path = target.split('|')[0];
          link.href = '#';
          link.addEventListener('click', (event) => {
            event.preventDefault();
            void this.app.workspace.openLinkText(path, this.taskPath, false);
          });
        } else {
          link.href = target;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
        links.appendChild(link);
      }
      links.hidden = seen.size === 0;
    };
    note.addEventListener('input', updateLinks);
    updateLinks();

    const error = element('div', 'zadachi-form-error');
    error.setAttribute('role', 'alert');
    const actions = element('div', 'zadachi-modal-actions');
    const cancel = element('button', '', this.i18n.t('cancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    const save = element('button', 'mod-cta', this.i18n.t('save'));
    save.type = 'submit';
    actions.append(cancel, save);
    form.append(titleLabel, priority, noteLabel, links, error, actions);
    this.contentEl.appendChild(form);

    let errorReason: unknown = null;
    const updateLocale = () => {
      this.titleEl.setText(this.i18n.t('editTitle'));
      if (titleLabel.firstChild) titleLabel.firstChild.textContent = this.i18n.t('title');
      title.setAttribute('aria-label', this.i18n.t('taskTitle'));
      if (noteLabel.firstChild) noteLabel.firstChild.textContent = this.i18n.t('noteOptional');
      note.placeholder = this.i18n.t('notePlaceholder');
      note.setAttribute('aria-label', this.i18n.t('note'));
      priority.setAttribute('aria-label', this.i18n.t('priority'));
      priorityLabel.textContent = this.i18n.t('priority');
      urgent.label.textContent = this.i18n.t('urgent');
      important.label.textContent = this.i18n.t('important');
      links.setAttribute('aria-label', this.i18n.t('noteLinks'));
      cancel.textContent = this.i18n.t('cancel');
      save.textContent = this.i18n.t('save');
      error.textContent = errorReason === null ? '' : this.i18n.error(errorReason, 'saveTaskFailed');
    };
    this.unsubLocale = this.i18n.subscribe(updateLocale);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.saving) return;
      if (this.service.getPath() !== this.taskPath) {
        errorReason = new LocalizedError('pathChangedEditor');
        error.textContent = this.i18n.error(errorReason);
        return;
      }
      const name = title.value.trim();
      if (!name) {
        errorReason = new LocalizedError('titleRequired');
        error.textContent = this.i18n.error(errorReason);
        title.focus();
        return;
      }
      const draft: TaskDraft = { title: name, note: note.value, urgent: urgent.pressed, important: important.pressed };
      this.saving = true;
      for (const control of [title, note, urgent.button, important.button, cancel, save]) control.disabled = true;
      errorReason = null;
      error.textContent = '';
      void this.service.update(this.task, draft).then(() => this.close()).catch((reason: unknown) => {
        errorReason = reason;
        const message = this.i18n.error(reason, 'saveTaskFailed');
        error.textContent = message;
        new Notice(message);
      }).finally(() => {
        this.saving = false;
        for (const control of [title, note, urgent.button, important.button, cancel, save]) control.disabled = false;
      });
    });
    title.focus();
  }

  onClose(): void {
    this.unsubLocale?.();
    this.unsubLocale = null;
    this.contentEl.empty();
    this.onDismiss();
  }

}
