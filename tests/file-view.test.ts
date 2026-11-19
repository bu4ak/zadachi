// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18n } from '../src/i18n';
import type { ArchiveRemoval, Task, TaskDraft, TaskService, TaskSnapshot } from '../src/types';
import { TaskView } from '../src/view';
import { installObsidianDom, Notice } from './obsidian-mock';

const task = (id: string, completedAt: string | null = null): Task => ({
  id, title: `Task ${id}`, note: '', urgent: false, important: false,
  createdAt: '2026-11-16T08:00:00.000Z', completedAt,
});

class Service implements TaskService {
  snapshot: TaskSnapshot;
  listeners = new Set<() => void>();
  constructor(public path: string, tasks: Task[] = []) { this.snapshot = { tasks, loading: false, error: null }; }
  getPath = () => this.path;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  emit(tasks: readonly Task[]): void { this.snapshot = { ...this.snapshot, tasks }; this.listeners.forEach(listener => listener()); }
  load = vi.fn(async () => {});
  add = vi.fn(async (draft: TaskDraft) => ({ ...task('new'), ...draft }));
  update = vi.fn(async (original: Task, draft: TaskDraft) => ({ ...original, ...draft }));
  complete = vi.fn(async (original: Task) => ({ ...original, completedAt: '2026-11-17T09:00:00.000Z' }));
  restore = vi.fn(async (original: Task) => ({ ...original, completedAt: null }));
  deleteArchived = vi.fn(async (original: Task): Promise<ArchiveRemoval> => ({ tasks: [original], storagePath: this.path }));
  clearArchive = vi.fn(async (originals: readonly Task[]): Promise<ArchiveRemoval> => ({ tasks: originals, storagePath: this.path }));
  undoArchiveRemoval = vi.fn(async (_removal: ArchiveRemoval) => {});
  moveTask = vi.fn(async (_original: Task, _anchor: Task, _direction: 'up' | 'down', _group: readonly Task[]) => {});
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const file = (path: string) => ({ path, basename: path.split('/').pop()!.replace(/\.md$/, '') });

beforeEach(() => { document.body.replaceChildren(); Notice.instances.length = 0; installObsidianDom(); });

function setup() {
  const aFile = file('A.md');
  const bFile = file('B.md');
  const a = new Service(aFile.path, [task('a')]);
  const b = new Service(bFile.path, [task('b')]);
  const releaseA = vi.fn();
  const releaseB = vi.fn();
  const files = {
    acquire: vi.fn((value: typeof aFile) => value === aFile ? { service: a, release: releaseA } : { service: b, release: releaseB }),
    defaultPath: () => aFile.path,
    openMarkdown: vi.fn(async () => {}),
  };
  const app = { workspace: {}, vault: { getAbstractFileByPath: (path: string) => path === aFile.path ? aFile : path === bFile.path ? bFile : null } };
  const view = new TaskView({ app } as any, a, new I18n('en'), files as any);
  document.body.append(view.containerEl);
  return { view, files, a, b, aFile, bFile, releaseA, releaseB };
}

describe('Панель файла задач', () => {
  it('не возвращается к старому файлу, если его чтение завершилось позже', async () => {
    const { view, a, b, aFile, bFile, releaseA } = setup();
    let finishA!: () => void;
    a.load.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; }));
    await view.onOpen();
    const oldLoad = view.onLoadFile(aFile as any);
    await view.onLoadFile(bFile as any);
    finishA();
    await oldLoad;
    await view.onUnloadFile(aFile as any);
    expect(view.getDisplayText()).toBe('B');
    expect(view.containerEl.querySelector('[data-task-id="b"]')).not.toBeNull();
    expect(view.containerEl.querySelector('[data-task-id="a"]')).toBeNull();
    expect(releaseA).toHaveBeenCalledOnce();
    expect(b.listeners.size).toBe(1);
    await view.onClose();
  });

  it('восстанавливает путь из состояния и открывает Markdown через меню', async () => {
    const { view, files, aFile, releaseA } = setup();
    await view.onOpen();
    expect(view.containerEl.querySelector<HTMLInputElement>('.zadachi-input')!.disabled).toBe(true);
    await view.setState({}, {} as any);
    expect(view.getState().file).toBe(aFile.path);
    expect(view.getDisplayText()).toBe('A');
    expect(view.canAcceptExtension('md')).toBe(false);
    expect(view.canAcceptExtension('png')).toBe(false);
    files.acquire.mockClear();
    await view.setState({ file: null }, {} as any);
    expect(files.acquire).not.toHaveBeenCalled();
    let action: (() => void) | undefined;
    const item = { setTitle: vi.fn().mockReturnThis(), setIcon: vi.fn().mockReturnThis(), onClick: vi.fn((fn: () => void) => { action = fn; return item; }) };
    view.onPaneMenu({ addItem: (callback: (value: typeof item) => void) => callback(item) } as any, 'more-options');
    expect(item.setTitle).toHaveBeenCalled();
    action!();
    await flush();
    expect(files.openMarkdown).toHaveBeenCalledWith((view as any).leaf, aFile);
    await view.onClose();
    expect(releaseA).toHaveBeenCalledOnce();
  });

  it('при смене файла очищает локальный ввод и отписывает старый список', async () => {
    const { view, a, b, aFile, bFile, releaseA, releaseB } = setup();
    await view.onOpen();
    await view.onLoadFile(aFile as any);
    const input = view.containerEl.querySelector<HTMLInputElement>('.zadachi-input')!;
    input.value = 'Draft A';
    view.selectTab('archive');
    await view.onLoadFile(bFile as any);
    expect(input.value).toBe('');
    expect(view.getDisplayText()).toBe('B');
    expect(view.containerEl.querySelector('[data-task-id="b"]')).not.toBeNull();
    expect(view.containerEl.querySelector('[data-task-id="a"]')).toBeNull();
    expect(a.listeners.size).toBe(0);
    expect(b.listeners.size).toBe(1);
    expect(releaseA).toHaveBeenCalledOnce();
    a.emit([task('late')]);
    expect(view.containerEl.querySelector('[data-task-id="late"]')).toBeNull();
    await view.onClose();
    expect(releaseB).toHaveBeenCalledOnce();
    expect(b.listeners.size).toBe(0);
  });

  it('не позволяет старому сохранению сбросить ввод или блокировку нового файла', async () => {
    const { view, a, b, aFile, bFile } = setup();
    let finishA!: (value: Task) => void;
    let finishB!: (value: Task) => void;
    a.add.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; }));
    b.add.mockImplementationOnce(() => new Promise(resolve => { finishB = resolve; }));
    await view.onOpen();
    await view.onLoadFile(aFile as any);
    const input = view.containerEl.querySelector<HTMLInputElement>('.zadachi-input')!;
    const form = view.containerEl.querySelector('form')!;
    input.value = 'Old draft';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await view.onLoadFile(bFile as any);
    input.value = 'New draft';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    finishA(task('old-result'));
    await flush();
    expect(input.value).toBe('New draft');
    expect(input.disabled).toBe(true);
    expect(b.add).toHaveBeenCalledOnce();
    finishB(task('new-result'));
    await flush();
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('');
    await view.onClose();
  });

  it('не сбрасывает блокировку нового перемещения после ответа старого файла', async () => {
    const { view, a, b, aFile, bFile } = setup();
    a.emit([task('1'), task('2')]);
    b.emit([task('1'), task('2')]);
    let finishA!: () => void;
    let finishB!: () => void;
    a.moveTask.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; }));
    b.moveTask.mockImplementationOnce(() => new Promise(resolve => { finishB = resolve; }));
    await view.onOpen();
    await view.onLoadFile(aFile as any);
    const pressUp = () => view.containerEl.querySelector<HTMLButtonElement>('[data-task-id="2"] .zadachi-drag-handle')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
    pressUp();
    await view.onLoadFile(bFile as any);
    pressUp();
    finishA();
    await flush();
    expect(view.containerEl.querySelector<HTMLButtonElement>('[data-task-id="2"] .zadachi-drag-handle')!.disabled).toBe(true);
    expect(view.containerEl.querySelector<HTMLInputElement>('[data-task-id="1"] .zadachi-check')!.disabled).toBe(true);
    finishB();
    await flush();
    expect(view.containerEl.querySelector<HTMLButtonElement>('[data-task-id="2"] .zadachi-drag-handle')!.disabled).toBe(false);
    await view.onClose();
  });

  it('отменяет выполнение в исходном файле после переключения панели', async () => {
    const { view, a, b, aFile, bFile } = setup();
    let finish!: (value: Task) => void;
    a.complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await view.onOpen();
    await view.onLoadFile(aFile as any);
    view.containerEl.querySelector<HTMLInputElement>('.zadachi-check')!.click();
    await view.onLoadFile(bFile as any);
    const completed = { ...task('a'), completedAt: '2026-11-17T09:00:00.000Z' };
    finish(completed);
    await flush();
    const undo = Notice.instances.at(-1)!.noticeEl.querySelector<HTMLButtonElement>('.zadachi-undo')!;
    undo.click();
    await flush();
    expect(a.restore).toHaveBeenCalledWith(completed);
    expect(b.restore).not.toHaveBeenCalled();
    expect(view.containerEl.querySelector('[data-task-id="b"]')).not.toBeNull();
    await view.onClose();
  });

  it('отменяет удаление архива в исходном файле, если панель открыла другой', async () => {
    const { view, a, b, aFile, bFile } = setup();
    const archived = task('archived', '2026-11-17T09:00:00.000Z');
    a.emit([archived]);
    let finish!: (value: ArchiveRemoval) => void;
    a.deleteArchived.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await view.onOpen();
    await view.onLoadFile(aFile as any);
    view.selectTab('archive');
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-delete-archived')!.click();
    document.querySelector<HTMLButtonElement>('.zadachi-confirm-delete')!.click();
    await flush();
    await view.onLoadFile(bFile as any);
    const receipt = { tasks: [archived], storagePath: aFile.path };
    finish(receipt);
    await flush();
    Notice.instances.at(-1)!.noticeEl.querySelector<HTMLButtonElement>('.zadachi-undo')!.click();
    await flush();
    expect(a.undoArchiveRemoval).toHaveBeenCalledWith(receipt);
    expect(b.undoArchiveRemoval).not.toHaveBeenCalled();
    await view.onClose();
  });

  it('отменяет удаление через новое хранилище после закрытия последней вкладки', async () => {
    const { view, files, a, aFile, releaseA } = setup();
    const archived = task('archived', '2026-11-17T09:00:00.000Z');
    a.emit([archived]);
    await view.onOpen();
    await view.onLoadFile(aFile as any);
    view.selectTab('archive');
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-delete-archived')!.click();
    document.querySelector<HTMLButtonElement>('.zadachi-confirm-delete')!.click();
    await flush();
    await view.onClose();
    expect(releaseA).toHaveBeenCalledOnce();
    const fresh = new Service(aFile.path);
    const releaseFresh = vi.fn();
    files.acquire.mockReturnValueOnce({ service: fresh, release: releaseFresh });
    Notice.instances.at(-1)!.noticeEl.querySelector<HTMLButtonElement>('.zadachi-undo')!.click();
    await flush();
    expect(fresh.undoArchiveRemoval).toHaveBeenCalledWith({ tasks: [archived], storagePath: aFile.path });
    expect(a.undoArchiveRemoval).not.toHaveBeenCalled();
    expect(releaseFresh).toHaveBeenCalledOnce();
  });

  it('закрывает окно редактирования при смене файла', async () => {
    const { view, aFile, bFile } = setup();
    await view.onOpen();
    await view.onLoadFile(aFile as any);
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-task-title')!.click();
    expect(document.querySelector('.zadachi-modal')).not.toBeNull();
    await view.onLoadFile(bFile as any);
    expect(document.querySelector('.zadachi-modal')).toBeNull();
    await view.onClose();
  });
});
