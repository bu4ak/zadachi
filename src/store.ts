import { normalizePath, TFile, TFolder, type Vault } from 'obsidian';
import { parseTasks, serializeTasks, sortActiveTasks, validateDraft } from './model';
import { LocalizedError } from './i18n';
import type { ArchiveRemoval, Task, TaskDraft, TaskService, TaskSnapshot } from './types';

export function validateStoragePath(input: string): string {
  const path = input.trim();
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-z]:/i.test(path) ||
      path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) ||
      !/\.md$/i.test(path)) {
    throw new LocalizedError('invalidPath');
  }
  return normalizePath(path);
}

function newId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') throw new LocalizedError('idFailed');
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameTask(a: Task, b: Task): boolean {
  return a.id === b.id && a.title === b.title && a.note === b.note && a.urgent === b.urgent &&
    a.important === b.important && a.createdAt === b.createdAt && a.completedAt === b.completedAt && a.order === b.order;
}

function samePriority(a: Task, b: Task): boolean {
  return a.urgent === b.urgent && a.important === b.important;
}

function activeGroup(tasks: readonly Task[], task: Task): Task[] {
  return sortActiveTasks(tasks.filter(item => item.completedAt === null && samePriority(item, task)));
}

function rankGroup(group: readonly Task[]): void {
  group.forEach((task, index) => { task.order = index; });
}

class ConflictError extends LocalizedError {}

interface PendingWrite { text?: string; snapshot?: TaskSnapshot }

export class TaskStore implements TaskService {
  private path: string;
  private snapshot: TaskSnapshot = { tasks: [], loading: true, error: null };
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private pendingWrite?: PendingWrite;
  private initializedPaths = new Set<string>();

  constructor(private readonly vault: Vault, path: string,
    private readonly options: { createIfMissing?: boolean; file?: TFile } = {}) {
    // Keep an invalid saved value visible, instead of silently selecting a different file.
    try { this.path = validateStoragePath(path); } catch { this.path = path; }
  }

  getPath(): string { return this.path; }
  getSnapshot(): TaskSnapshot { return this.snapshot; }
  whenIdle(): Promise<void> { return this.queue; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(snapshot: TaskSnapshot): void {
    const previous = this.snapshot;
    if (previous.loading === snapshot.loading && previous.error === snapshot.error &&
        previous.tasks.length === snapshot.tasks.length &&
        previous.tasks.every((task, index) => sameTask(task, snapshot.tasks[index]))) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      try { listener(); } catch (error) { console.error('Задачи: ошибка обновления панели', error); }
    }
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action, action);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private isCurrentFile(file: TFile, path: string): boolean {
    return file.path === path && this.vault.getAbstractFileByPath(path) === file &&
      (!this.options.file || this.options.file === file);
  }

  private async ensureFolder(path: string): Promise<void> {
    const parts = path ? path.split('/') : [];
    let folderPath = '';
    for (const part of parts) {
      folderPath = folderPath ? `${folderPath}/${part}` : part;
      let folder = this.vault.getAbstractFileByPath(folderPath);
      if (!folder) {
        try { await this.vault.createFolder(folderPath); } catch (error) {
          folder = this.vault.getAbstractFileByPath(folderPath);
          if (!(folder instanceof TFolder)) throw error;
        }
        folder = this.vault.getAbstractFileByPath(folderPath);
      }
      if (!(folder instanceof TFolder)) throw new LocalizedError('folderOccupied', { path: folderPath });
    }
  }

  private async createFile(path: string): Promise<TFile> {
    const parts = path.split('/');
    parts.pop();
    await this.ensureFolder(parts.join('/'));
    try {
      return await this.vault.create(path, serializeTasks([]));
    } catch (error) {
      const existing = this.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) return existing;
      throw error;
    }
  }

  private async loadNow(showLoading: boolean, requireExisting = false, write?: PendingWrite): Promise<void> {
    const path = this.path;
    if (showLoading) this.publish({ ...this.snapshot, loading: true });
    try {
      validateStoragePath(path);
      let file = this.vault.getAbstractFileByPath(path);
      if (!file) {
        if (requireExisting || this.options.file || this.options.createIfMissing === false || this.initializedPaths.has(path)) {
          throw new LocalizedError('fileMissing', { path });
        }
        file = await this.createFile(path);
      }
      if (!(file instanceof TFile)) throw new LocalizedError('notFile', { path });
      if (!this.isCurrentFile(file, path)) throw new LocalizedError('pathChangedAction');
      // Remember existing files even when their content is malformed: never recreate them silently.
      this.initializedPaths.add(path);
      const text = await this.vault.read(file);
      if (!this.isCurrentFile(file, path)) throw new LocalizedError('pathChangedAction');
      // Recheck the actual file: a sync or editor change may follow our write.
      if (write?.text === text && write.snapshot === this.snapshot) return;
      const tasks = parseTasks(text);
      this.publish({ tasks, loading: false, error: null });
    } catch (error) {
      this.publish({ tasks: this.snapshot.tasks, loading: false, error: errorMessage(error), errorCause: error });
    }
  }

  load(): Promise<void> {
    const write = this.pendingWrite;
    return this.enqueue(() => this.loadNow(this.snapshot.loading, false, write));
  }

  private async writeTasks(file: TFile, path: string, change: (tasks: Task[]) => Task[]): Promise<void> {
    const write: PendingWrite = {};
    let next: Task[] | undefined;
    let conflict: Task[] | undefined;
    let serialized: string | undefined;
    this.pendingWrite = write;
    try {
      const written = await this.vault.process(file, current => {
        if (this.path !== path || !this.isCurrentFile(file, path)) throw new LocalizedError('pathChangedAction');
        const tasks = parseTasks(current);
        try { next = change(tasks); }
        catch (error) {
          // Conflict checks must run before any objects from this parse are mutated.
          if (error instanceof ConflictError) conflict = tasks;
          throw error;
        }
        return serialized = serializeTasks(next);
      });
      if (this.path !== path || !this.isCurrentFile(file, path)) throw new LocalizedError('pathChangedAction');
      const tasks = next && written === serialized ? next : parseTasks(written);
      this.initializedPaths.add(path);
      this.publish({ tasks, loading: false, error: null });
      write.text = written;
      write.snapshot = this.snapshot;
    } catch (error) {
      if (error instanceof ConflictError && conflict) this.publish({ tasks: conflict, loading: false, error: null });
      throw error;
    } finally {
      this.pendingWrite = undefined;
    }
  }

  followRename(input: string): Promise<void> {
    const path = validateStoragePath(input);
    return this.enqueue(async () => {
      const previousPath = this.path;
      this.path = path;
      this.initializedPaths.delete(previousPath);
      // A rename always targets an existing file; later reloads must not recreate it.
      this.initializedPaths.add(path);
      await this.loadNow(false, true);
    });
  }

  setPath(input: string): Promise<void> {
    const path = validateStoragePath(input);
    return this.enqueue(async () => {
      const previousPath = this.path;
      const previousSnapshot = this.snapshot;
      if (path !== this.path) {
        this.path = path;
        this.publish({ tasks: [], loading: true, error: null });
      }
      await this.loadNow(true);
      if (this.snapshot.error) {
        const cause = this.snapshot.errorCause;
        if (path !== previousPath) {
          this.path = previousPath;
          this.publish(previousSnapshot);
        }
        throw cause instanceof Error ? cause : new LocalizedError('unknownError', {}, cause);
      }
    });
  }

  private mutate(change: (tasks: Task[]) => Task): Promise<Task> {
    // A file change already queued must not redirect an action started on the old list.
    const requestedPath = this.path;
    return this.enqueue(async () => {
      const path = this.path;
      if (path !== requestedPath) throw new LocalizedError('pathChangedAction');
      validateStoragePath(path);
      const file = this.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new LocalizedError('fileMissing', { path });
      if (!this.isCurrentFile(file, path)) throw new LocalizedError('pathChangedAction');
      let updated: Task | undefined;
      try {
        await this.writeTasks(file, path, tasks => {
          updated = change(tasks);
          return tasks;
        });
        if (!updated) throw new LocalizedError('changeNotSaved');
        return { ...updated };
      } catch (error) {
        if (error instanceof ConflictError || (error instanceof LocalizedError &&
            (error.key === 'pathChangedAction' || error.key === 'reorderInvalid'))) throw error;
        throw new LocalizedError('saveFailed', {}, error);
      }
    });
  }

  add(draft: TaskDraft): Promise<Task> {
    const safeDraft = validateDraft(draft);
    const task: Task = { ...safeDraft, id: newId(), createdAt: new Date().toISOString(), completedAt: null };
    return this.mutate(tasks => {
      if (tasks.some(existing => existing.id === task.id)) throw new LocalizedError('duplicateId');
      const group = activeGroup(tasks, task);
      if (group.some(item => item.order !== undefined)) {
        rankGroup(group);
        task.order = group.length;
      }
      tasks.push(task);
      return task;
    });
  }

  private replace(original: Task, change: (current: Task, tasks: Task[]) => Task): Promise<Task> {
    const expected = { ...original };
    return this.mutate(tasks => {
      const index = tasks.findIndex(task => task.id === expected.id);
      if (index < 0 || !sameTask(tasks[index], expected)) {
        throw new ConflictError('taskConflict');
      }
      const task = change(tasks[index], tasks);
      tasks[index] = task;
      return task;
    });
  }

  update(original: Task, draft: TaskDraft): Promise<Task> {
    const safeDraft = validateDraft(draft);
    return this.replace(original, (current, tasks) => {
      const updated = { ...current, ...safeDraft };
      if (!samePriority(current, updated)) {
        delete updated.order;
        if (updated.completedAt === null) {
          const destination = activeGroup(tasks, updated);
          if (destination.some(item => item.order !== undefined)) {
            rankGroup(destination);
            updated.order = destination.length;
          }
        }
      }
      return updated;
    });
  }

  complete(original: Task): Promise<Task> {
    return this.replace(original, current => {
      if (current.completedAt !== null) throw new LocalizedError('alreadyCompleted');
      return { ...current, completedAt: new Date().toISOString() };
    });
  }

  restore(original: Task): Promise<Task> {
    return this.replace(original, (current, tasks) => {
      if (current.completedAt === null) throw new LocalizedError('alreadyActive');
      const restored = { ...current, completedAt: null };
      const group = activeGroup(tasks, restored);
      if (current.order !== undefined) {
        group.splice(Math.min(current.order, group.length), 0, restored);
        rankGroup(group);
      } else if (group.some(item => item.order !== undefined)) {
        group.push(restored);
        rankGroup(group);
      }
      return restored;
    });
  }

  moveTask(original: Task, anchor: Task, direction: 'up' | 'down', group: readonly Task[]): Promise<void> {
    const source = { ...original };
    const target = { ...anchor };
    const expected = group.map(task => ({ ...task }));
    return this.mutate(tasks => {
      if ((direction !== 'up' && direction !== 'down') || source.id === target.id ||
          source.completedAt !== null || target.completedAt !== null || !samePriority(source, target) ||
          expected.some(task => task.completedAt !== null || !samePriority(task, source)) ||
          new Set(expected.map(task => task.id)).size !== expected.length ||
          !expected.some(task => task.id === source.id) || !expected.some(task => task.id === target.id)) {
        throw new LocalizedError('reorderInvalid');
      }
      const current = activeGroup(tasks, source);
      const expectedOrdered = sortActiveTasks(expected);
      if (current.length !== expectedOrdered.length || current.some((task, index) =>
        task.id !== expectedOrdered[index].id || task.order !== expectedOrdered[index].order)) {
        throw new ConflictError('reorderConflict');
      }
      const sourceIndex = current.findIndex(task => task.id === source.id);
      const targetIndex = current.findIndex(task => task.id === target.id);
      if (sourceIndex < 0 || targetIndex < 0 || !sameTask(current[sourceIndex], source) ||
          !sameTask(current[targetIndex], target)) throw new ConflictError('reorderConflict');
      if ((direction === 'up' && targetIndex >= sourceIndex) || (direction === 'down' && targetIndex <= sourceIndex)) {
        throw new LocalizedError('reorderInvalid');
      }
      const [moving] = current.splice(sourceIndex, 1);
      const insertAt = current.findIndex(task => task.id === target.id) + (direction === 'down' ? 1 : 0);
      current.splice(insertAt, 0, moving);
      rankGroup(current);
      return moving;
    }).then(() => undefined);
  }

  private removeArchived(originals: readonly Task[], all: boolean): Promise<ArchiveRemoval> {
    const expected = originals.map(task => Object.freeze({ ...task }));
    const requestedPath = this.path;
    return this.enqueue(async () => {
      const path = this.path;
      if (path !== requestedPath) throw new LocalizedError('pathChangedAction');
      validateStoragePath(path);
      if (!expected.length) throw new LocalizedError('archiveEmpty');
      if (expected.some(task => task.completedAt === null)) throw new LocalizedError('deleteActiveForbidden');
      const ids = new Set(expected.map(task => task.id));
      if (ids.size !== expected.length) {
        throw new ConflictError(all ? 'archiveChanged' : 'taskConflict');
      }
      const file = this.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new LocalizedError('fileMissing', { path });
      if (!this.isCurrentFile(file, path)) throw new LocalizedError('pathChangedAction');

      try {
        await this.writeTasks(file, path, tasks => {
          if (all) {
            const archived = new Map<string, Task>();
            const active: Task[] = [];
            for (const task of tasks) {
              if (task.completedAt === null) active.push(task);
              else archived.set(task.id, task);
            }
            if (archived.size !== expected.length || expected.some(original => {
              const actual = archived.get(original.id);
              return !actual || !sameTask(original, actual);
            })) throw new ConflictError('archiveChanged');
            return active;
          }
          const index = tasks.findIndex(task => task.id === expected[0].id);
          if (index < 0 || !sameTask(expected[0], tasks[index])) throw new ConflictError('taskConflict');
          tasks.splice(index, 1);
          return tasks;
        });
        return Object.freeze({ tasks: Object.freeze(expected), storagePath: path });
      } catch (error) {
        if (error instanceof ConflictError || (error instanceof LocalizedError && error.key === 'pathChangedAction')) throw error;
        throw new LocalizedError('saveFailed', {}, error);
      }
    });
  }

  deleteArchived(original: Task): Promise<ArchiveRemoval> {
    return this.removeArchived([original], false);
  }

  clearArchive(originals: readonly Task[]): Promise<ArchiveRemoval> {
    return this.removeArchived(originals, true);
  }

  undoArchiveRemoval(removal: ArchiveRemoval): Promise<void> {
    const requestedPath = this.path;
    const expectedPath = removal.storagePath;
    const restored = removal.tasks.map(task => ({ ...task }));
    return this.enqueue(async () => {
      const path = this.path;
      if (path !== requestedPath || path !== expectedPath) throw new LocalizedError('pathChangedAction');
      validateStoragePath(path);
      const file = this.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new LocalizedError('fileMissing', { path });
      if (!this.isCurrentFile(file, path)) throw new LocalizedError('pathChangedAction');
      try {
        // Validate the receipt before modifying the file.
        if (!restored.length || restored.some(task => task.completedAt === null)) throw new LocalizedError('archiveUndoConflict');
        serializeTasks(restored);
        await this.writeTasks(file, path, tasks => {
          const ids = new Set(tasks.map(task => task.id));
          if (restored.some(task => ids.has(task.id))) throw new ConflictError('archiveUndoConflict');
          return tasks.concat(restored);
        });
      } catch (error) {
        if (error instanceof ConflictError || (error instanceof LocalizedError &&
            (error.key === 'archiveUndoConflict' || error.key === 'pathChangedAction'))) throw error;
        throw new LocalizedError('saveFailed', {}, error);
      }
    });
  }
}
