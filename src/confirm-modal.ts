import { App, Modal } from 'obsidian';
import { I18n, LocalizedError } from './i18n';
import type { ArchiveRemoval, Task, TaskService } from './types';

export class ArchiveConfirmModal extends Modal {
  private readonly originals: Task[];
  private readonly path: string;
  private pending = false;
  private unsubLocale: (() => void) | null = null;

  constructor(
    app: App,
    private readonly service: TaskService,
    private readonly i18n: I18n,
    private readonly mode: 'single' | 'all',
    tasks: readonly Task[],
    private readonly onSuccess: (removal: ArchiveRemoval) => void,
    private readonly onBusy: (busy: boolean) => void,
    private readonly onDismiss: () => void,
  ) {
    super(app);
    this.originals = tasks.map(task => ({ ...task }));
    this.path = service.getPath();
  }

  onOpen(): void {
    this.modalEl.addClass('zadachi-confirm-modal');
    this.contentEl.empty();
    const description = document.createElement('p');
    const error = document.createElement('div');
    error.className = 'zadachi-form-error';
    error.setAttribute('role', 'alert');
    const actions = document.createElement('div');
    actions.className = 'zadachi-modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.close());
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'mod-warning zadachi-confirm-delete';
    actions.append(cancel, confirm);
    this.contentEl.append(description, error, actions);

    let errorReason: unknown = null;
    const updateLocale = () => {
      this.titleEl.setText(this.i18n.t(this.mode === 'all' ? 'clearArchiveTitle' : 'deleteTaskTitle'));
      description.textContent = this.mode === 'all'
        ? this.i18n.t('clearArchiveDescription', { count: this.originals.length })
        : this.i18n.t('deleteTaskDescription', { title: this.originals[0].title });
      cancel.textContent = this.i18n.t('cancel');
      confirm.textContent = this.i18n.t(this.mode === 'all' ? 'clearArchiveConfirm' : 'deleteTaskConfirm');
      error.textContent = errorReason === null ? '' : this.i18n.error(errorReason, 'archiveRemovalFailed');
    };
    updateLocale();
    this.unsubLocale = this.i18n.subscribe(updateLocale);
    confirm.addEventListener('click', () => {
      if (this.pending) return;
      if (this.service.getPath() !== this.path) {
        errorReason = new LocalizedError('pathChangedSettings');
        updateLocale();
        return;
      }
      this.pending = true;
      cancel.disabled = true;
      confirm.disabled = true;
      errorReason = null;
      error.textContent = '';
      this.onBusy(true);
      void Promise.resolve().then(() => this.mode === 'all'
        ? this.service.clearArchive(this.originals)
        : this.service.deleteArchived(this.originals[0])).then(removal => {
        this.pending = false;
        this.onBusy(false);
        this.onSuccess(removal);
        this.close();
      }).catch((reason: unknown) => {
        this.pending = false;
        this.onBusy(false);
        cancel.disabled = false;
        confirm.disabled = false;
        errorReason = reason;
        updateLocale();
      });
    });
  }

  close(): void {
    if (!this.pending) super.close();
  }

  onClose(): void {
    this.unsubLocale?.();
    this.unsubLocale = null;
    this.contentEl.empty();
    this.onDismiss();
  }
}
