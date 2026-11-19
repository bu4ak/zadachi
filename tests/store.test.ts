import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vault } from 'obsidian';
import { TaskStore, validateStoragePath } from '../src/store';
import { parseTasks, serializeTasks, sortActiveTasks } from '../src/model';
import { I18n } from '../src/i18n';

vi.mock('obsidian', () => {
  class TFile { constructor(public path: string) {} }
  class TFolder { constructor(public path: string) {} }
  return { TFile, TFolder, normalizePath: (path: string) => path };
});

import { TFile, TFolder } from 'obsidian';

class FakeVault {
  files = new Map<string, { file: TFile; text: string }>();
  folders = new Map<string, TFolder>();
  failWrite = false;
  getAbstractFileByPath(path: string): TFile | TFolder | null {
    return this.files.get(path)?.file ?? this.folders.get(path) ?? null;
  }
  async createFolder(path: string): Promise<TFolder> {
    const folder = new (TFolder as unknown as new (path: string) => TFolder)(path);
    this.folders.set(path, folder);
    return folder;
  }
  async create(path: string, text: string): Promise<TFile> {
    if (this.files.has(path)) throw new Error('Файл существует');
    const file = new (TFile as unknown as new (path: string) => TFile)(path);
    this.files.set(path, { file, text });
    return file;
  }
  async read(file: TFile): Promise<string> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error('Файл удалён');
    return entry.text;
  }
  async process(file: TFile, callback: (text: string) => string): Promise<string> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error('Файл удалён');
    const next = callback(entry.text);
    if (this.failWrite) throw new Error('Нет доступа к записи');
    entry.text = next;
    return next;
  }
}

const draft = { title: 'Задача', note: '[[Заметка]]', urgent: false, important: true };
let vault: FakeVault;
let store: TaskStore;

beforeEach(async () => {
  vault = new FakeVault();
  store = new TaskStore(vault as unknown as Vault, 'Дела/Задачи.md');
  await store.load();
});

describe('Хранилище', () => {
  it('создаёт файл и сохраняет задачи после перезапуска', async () => {
    const created = await store.add(draft);
    const restarted = new TaskStore(vault as unknown as Vault, 'Дела/Задачи.md');
    await restarted.load();
    expect(restarted.getSnapshot().tasks).toEqual([created]);
    expect(vault.folders.has('Дела')).toBe(true);
  });

  it('не воссоздаёт удалённый файл и показывает ошибку', async () => {
    await store.add(draft);
    vault.files.delete('Дела/Задачи.md');
    await store.load();
    expect(store.getSnapshot().error).toContain('не найден');
    expect(vault.files.has('Дела/Задачи.md')).toBe(false);
  });

  it('объединяет добавление с внешним изменением файла', async () => {
    const first = await store.add(draft);
    const entry = vault.files.get(store.getPath())!;
    entry.text = serializeTasks([{ ...first, title: 'Внешнее изменение' }]);
    await store.add({ ...draft, title: 'Вторая задача' });
    expect(parseTasks(entry.text).map(task => task.title)).toEqual(['Внешнее изменение', 'Вторая задача']);
  });

  it('не перезаписывает изменённую извне задачу', async () => {
    const original = await store.add(draft);
    const entry = vault.files.get(store.getPath())!;
    entry.text = serializeTasks([{ ...original, title: 'Внешнее изменение' }]);
    await expect(store.update(original, { ...draft, title: 'Моё изменение' })).rejects.toThrow('изменилась');
    expect(parseTasks(entry.text)[0].title).toBe('Внешнее изменение');
    expect(store.getSnapshot().tasks[0].title).toBe('Внешнее изменение');
  });

  it('сохраняет внешнее изменение другой задачи при редактировании', async () => {
    const first = await store.add(draft);
    const second = await store.add({ ...draft, title: 'Вторая' });
    const entry = vault.files.get(store.getPath())!;
    entry.text = serializeTasks([first, { ...second, note: 'Добавлено извне' }]);
    await store.update(first, { ...draft, title: 'Изменённая первая' });
    expect(parseTasks(entry.text)).toMatchObject([
      { id: first.id, title: 'Изменённая первая' },
      { id: second.id, title: 'Вторая', note: 'Добавлено извне' },
    ]);
  });

  it('сохраняет исходные данные при ошибке записи', async () => {
    const original = await store.add(draft);
    const entry = vault.files.get(store.getPath())!;
    vault.failWrite = true;
    await expect(store.complete(original)).rejects.toThrow('Нет доступа');
    expect(parseTasks(entry.text)).toEqual([original]);
    expect(store.getSnapshot().tasks).toEqual([original]);
  });

  it('выполняет и восстанавливает задачу без потери данных', async () => {
    const original = await store.add(draft);
    const completed = await store.complete(original);
    expect(completed.completedAt).toBeTruthy();
    const restored = await store.restore(completed);
    expect(restored).toEqual(original);
  });

  it('не уведомляет повторно после чтения собственного сохранения', async () => {
    const original = await store.add(draft);
    const notifications: Array<{ loading: boolean; completed: boolean }> = [];
    store.subscribe(() => {
      const snapshot = store.getSnapshot();
      notifications.push({ loading: snapshot.loading, completed: snapshot.tasks[0]?.completedAt !== null });
    });
    await store.complete(original);
    await store.load();
    expect(notifications).toEqual([{ loading: false, completed: true }]);
  });

  it('публикует внешнее изменение без промежуточной загрузки', async () => {
    const original = await store.add(draft);
    const notifications: Array<{ loading: boolean; title: string }> = [];
    store.subscribe(() => {
      const snapshot = store.getSnapshot();
      notifications.push({ loading: snapshot.loading, title: snapshot.tasks[0]?.title });
    });
    vault.files.get(store.getPath())!.text = serializeTasks([{ ...original, title: 'Внешняя правка' }]);
    await store.load();
    expect(notifications).toEqual([{ loading: false, title: 'Внешняя правка' }]);
  });

  it('читает внешнюю правку даже если уведомление пришло во время собственной записи', async () => {
    const original = await store.add(draft);
    const process = vault.process.bind(vault);
    let reload: Promise<void> | undefined;
    vi.spyOn(vault, 'process').mockImplementationOnce(async (file, callback) => {
      const written = await process(file, callback);
      reload = store.load();
      vault.files.get(file.path)!.text = serializeTasks(parseTasks(written).map(task => ({ ...task, title: 'Правка из редактора' })));
      return written;
    });
    await store.complete(original);
    await reload;
    expect(store.getSnapshot().tasks[0]).toMatchObject({ title: 'Правка из редактора', completedAt: expect.any(String) });
  });

  it('при ошибке фонового чтения показывает ошибку и сохраняет снимок', async () => {
    const original = await store.add(draft);
    const notifications: Array<{ loading: boolean; error: string | null }> = [];
    store.subscribe(() => {
      const snapshot = store.getSnapshot();
      notifications.push({ loading: snapshot.loading, error: snapshot.error });
    });
    const entry = vault.files.get(store.getPath())!;
    entry.text = 'Повреждённый файл';
    await store.load();
    expect(store.getSnapshot().tasks).toEqual([original]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].loading).toBe(false);
    expect(notifications[0].error).toContain('формат');
    entry.text = serializeTasks([original]);
    await store.load();
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().tasks).toEqual([original]);
    expect(notifications).toHaveLength(2);
  });

  it('показывает загрузку при открытии нового файла и первой загрузке', async () => {
    const fresh = new TaskStore(vault as unknown as Vault, 'Первый.md');
    const notifications: boolean[] = [];
    fresh.subscribe(() => notifications.push(fresh.getSnapshot().loading));
    expect(fresh.getSnapshot().loading).toBe(true);
    await fresh.load();
    expect(notifications).toEqual([false]);
    notifications.length = 0;
    await fresh.setPath('Второй.md');
    expect(notifications).toEqual([true, false]);
  });

  it('сериализует конкурентные операции', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.add({ ...draft, title: `Задача ${i}` })));
    expect(store.getSnapshot().tasks).toHaveLength(8);
    expect(new Set(store.getSnapshot().tasks.map(task => task.id)).size).toBe(8);
  });

  it('не переносит действия в файл, смена которого уже стоит в очереди', async () => {
    const original = await store.add(draft);
    const changePath = store.setPath('Другой.md');
    const addOldList = store.add({ ...draft, title: 'Добавление в старый список' });
    const updateOldList = store.update(original, { ...draft, title: 'Правка старого списка' });
    const results = await Promise.allSettled([changePath, addOldList, updateOldList]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('rejected');
    expect(parseTasks(vault.files.get('Другой.md')!.text)).toEqual([]);
    expect(parseTasks(vault.files.get('Дела/Задачи.md')!.text)).toEqual([original]);
  });

  it('применяет сохранение после начавшейся загрузки и сохраняет внешние правки', async () => {
    const first = await store.add(draft);
    const entry = vault.files.get(store.getPath())!;
    const originalRead = vault.read.bind(vault);
    let release!: () => void;
    let started!: () => void;
    const pause = new Promise<void>(resolve => { release = resolve; });
    const reading = new Promise<void>(resolve => { started = resolve; });
    vault.read = async file => {
      const text = await originalRead(file);
      started();
      await pause;
      return text;
    };
    const loading = store.load();
    await reading;
    entry.text = serializeTasks([{ ...first, note: 'Внешняя правка' }]);
    const adding = store.add({ ...draft, title: 'Новая задача' });
    release();
    await Promise.all([loading, adding]);
    expect(parseTasks(entry.text)).toMatchObject([
      { id: first.id, note: 'Внешняя правка' },
      { title: 'Новая задача' },
    ]);
    expect(store.getSnapshot().tasks).toEqual(parseTasks(entry.text));
  });

  it('не трогает чужой или повреждённый файл', async () => {
    const entry = vault.files.get(store.getPath())!;
    entry.text = '# Важная чужая заметка\n';
    await store.load();
    expect(store.getSnapshot().error).toContain('формат');
    await expect(store.add(draft)).rejects.toThrow('формат');
    expect(entry.text).toBe('# Важная чужая заметка\n');
  });

  it('откатывает смену пути при ошибке чтения нового файла', async () => {
    const original = await store.add(draft);
    await vault.create('Чужой.md', 'Не формат задач');
    await expect(store.setPath('Чужой.md')).rejects.toThrow();
    expect(store.getPath()).toBe('Дела/Задачи.md');
    expect(store.getSnapshot().tasks).toEqual([original]);
  });

  it('сохраняет переводимые причины ошибок при чтении, записи и смене пути', async () => {
    const original = await store.add(draft);
    const entry = vault.files.get(store.getPath())!;
    entry.text = serializeTasks([original]).replace('Срочно: нет', 'Срочно: unknown');
    const en = new I18n('en');
    await store.load();
    expect(en.error(store.getSnapshot().errorCause)).toBe('Could not read the task file: Invalid task priority.');
    let saveError: unknown;
    try { await store.add(draft); } catch (error) { saveError = error; }
    expect(en.error(saveError)).toBe('Could not save tasks: Could not read the task file: Invalid task priority.');
    await vault.create('Чужой.md', 'Не формат задач');
    let pathError: unknown;
    try { await store.setPath('Чужой.md'); } catch (error) { pathError = error; }
    expect(en.error(pathError)).toBe('The task file has an unknown format or is damaged.');
    expect(store.getPath()).toBe('Дела/Задачи.md');
  });

  it('отклоняет пути вне хранилища и скрытые каталоги', () => {
    for (const path of ['/tmp/Задачи.md', '../Задачи.md', '.obsidian/data.md', 'C:\\data.md', 'файл.txt']) {
      expect(() => validateStoragePath(path)).toThrow();
    }
    expect(validateStoragePath('Дела/Задачи.md')).toBe('Дела/Задачи.md');
  });
});

describe('Открытие существующих файлов и переименование', () => {
  it('не создаёт отсутствующий файл при строгом открытии', async () => {
    const strict = new TaskStore(vault as unknown as Vault, 'Новая/Задачи.md', { createIfMissing: false });
    const create = vi.spyOn(vault, 'create');
    const createFolder = vi.spyOn(vault, 'createFolder');
    await strict.load();
    expect(strict.getSnapshot().error).toContain('не найден');
    expect(create).not.toHaveBeenCalled();
    expect(createFolder).not.toHaveBeenCalled();
    expect(vault.files.has('Новая/Задачи.md')).toBe(false);
  });

  it('не воссоздаёт удалённый файл при строгом открытии', async () => {
    const task = await store.add(draft);
    const strict = new TaskStore(vault as unknown as Vault, store.getPath(), { createIfMissing: false });
    await strict.load();
    vault.files.delete(store.getPath());
    const create = vi.spyOn(vault, 'create');
    await strict.load();
    expect(strict.getSnapshot().error).toContain('не найден');
    expect(strict.getSnapshot().tasks).toEqual([task]);
    expect(create).not.toHaveBeenCalled();
  });

  it('следует за переименованием файла и папки, сохраняя задачи и порядок', async () => {
    await store.add({ ...draft, title: 'Первая' });
    await store.add({ ...draft, title: 'Вторая' });
    const initial = sortActiveTasks(store.getSnapshot().tasks);
    await store.moveTask(initial[1], initial[0], 'up', initial);
    const expected = store.getSnapshot().tasks;
    const oldPath = store.getPath();
    const entry = vault.files.get(oldPath)!;
    const bound = new TaskStore(vault as unknown as Vault, oldPath, { createIfMissing: false, file: entry.file });
    await bound.load();
    vault.files.delete(oldPath);
    entry.file.path = 'Дела/Новое имя.md';
    vault.files.set(entry.file.path, entry);
    await bound.followRename(entry.file.path);
    expect(bound.getPath()).toBe('Дела/Новое имя.md');
    expect(bound.getSnapshot().tasks).toEqual(expected);
    vault.files.delete(entry.file.path);
    entry.file.path = 'Работа/Новое имя.md';
    vault.files.set(entry.file.path, entry);
    await bound.followRename(entry.file.path);
    expect(bound.getPath()).toBe('Работа/Новое имя.md');
    expect(bound.getSnapshot().tasks).toEqual(expected);
    const extra = await bound.add({ ...draft, title: 'После переименования' });
    expect(parseTasks(entry.text).map(task => task.id)).toContain(extra.id);
  });

  it('сохраняет ошибку и прежний список, если переименованный файл отсутствует', async () => {
    const task = await store.add(draft);
    const create = vi.spyOn(vault, 'create');
    await store.followRename('Дела/Отсутствует.md');
    expect(store.getPath()).toBe('Дела/Отсутствует.md');
    expect(store.getSnapshot().tasks).toEqual([task]);
    expect(store.getSnapshot().error).toContain('не найден');
    await store.load();
    expect(store.getSnapshot().error).toContain('не найден');
    expect(create).not.toHaveBeenCalled();
  });

  it('отклоняет ожидающую запись после переименования и сохраняет новые действия', async () => {
    const task = await store.add(draft);
    const oldPath = store.getPath();
    const entry = vault.files.get(oldPath)!;
    const process = vault.process.bind(vault);
    let release!: () => void;
    let started!: () => void;
    const pause = new Promise<void>(resolve => { release = resolve; });
    const processing = new Promise<void>(resolve => { started = resolve; });
    vi.spyOn(vault, 'process').mockImplementationOnce(async (file, callback) => {
      started();
      await pause;
      return process(file, callback);
    });
    const write = store.update(task, { ...draft, title: 'Старое действие' });
    await processing;
    vault.files.delete(oldPath);
    entry.file.path = 'Дела/Переименован.md';
    vault.files.set(entry.file.path, entry);
    const rename = store.followRename(entry.file.path);
    release();
    await expect(write).rejects.toThrow('Файл задач изменился');
    await rename;
    expect(parseTasks(entry.text)).toEqual([task]);
    const updated = await store.update(task, { ...draft, title: 'Новое действие' });
    expect(parseTasks(entry.text)).toEqual([updated]);
  });

  it('не читает и не изменяет заменённый файл по прежнему пути', async () => {
    await store.add({ ...draft, title: 'Первая' });
    await store.add({ ...draft, title: 'Вторая' });
    const archived = await store.complete(await store.add({ ...draft, title: 'Архив' }));
    const path = store.getPath();
    const originalFile = vault.files.get(path)!.file;
    const bound = new TaskStore(vault as unknown as Vault, path, { createIfMissing: false, file: originalFile });
    await bound.load();
    const removal = await bound.deleteArchived(archived);
    const group = sortActiveTasks(bound.getSnapshot().tasks);
    vault.files.delete(path);
    const replacementText = serializeTasks(group);
    await vault.create(path, replacementText);
    const process = vi.spyOn(vault, 'process');
    const read = vi.spyOn(vault, 'read');
    await expect(bound.update(group[0], { ...draft, title: 'Изменение' })).rejects.toThrow('Файл задач изменился');
    await expect(bound.undoArchiveRemoval(removal)).rejects.toThrow('Файл задач изменился');
    await expect(bound.add(draft)).rejects.toThrow('Файл задач изменился');
    await expect(bound.clearArchive(removal.tasks)).rejects.toThrow('Файл задач изменился');
    await expect(bound.moveTask(group[1], group[0], 'up', group)).rejects.toThrow('Файл задач изменился');
    await bound.load();
    expect(bound.getSnapshot().error).toContain('Файл задач изменился');
    expect(process).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(vault.files.get(path)!.text).toBe(replacementText);
  });
});

describe('Удаление из архива', () => {
  async function completed(title: string) {
    return store.complete(await store.add({ ...draft, title, urgent: true, note: `[[${title}]]\nПодробности` }));
  }

  it('удаляет одну выполненную задачу и сохраняет её данные для отмены', async () => {
    const active = await store.add({ ...draft, title: 'Активная' });
    const first = await completed('Первая');
    const second = await completed('Вторая');
    const removal = await store.deleteArchived(first);
    expect(removal.storagePath).toBe('Дела/Задачи.md');
    expect(removal.tasks).toEqual([first]);
    expect(parseTasks(vault.files.get(removal.storagePath)!.text)).toEqual([active, second]);
    expect(Object.isFrozen(removal)).toBe(true);
    expect(Object.isFrozen(removal.tasks)).toBe(true);
    expect(Object.isFrozen(removal.tasks[0])).toBe(true);
  });

  it('очищает весь архив, сохраняя активные задачи', async () => {
    const active = await store.add(draft);
    const first = await completed('Первая');
    const second = await completed('Вторая');
    const removal = await store.clearArchive([first, second]);
    expect(parseTasks(vault.files.get(removal.storagePath)!.text)).toEqual([active]);
    expect(removal.tasks).toEqual([first, second]);
  });

  it('не создаёт файлы или папки и не трогает старые копии при удалении и отмене', async () => {
    const first = await completed('Первая');
    const second = await completed('Вторая');
    await vault.createFolder('Дела/Задачи.backups');
    const oldPath = 'Дела/Задачи.backups/old.md';
    await vault.create(oldPath, 'Старая копия');
    const files = [...vault.files.keys()];
    const folders = [...vault.folders.keys()];
    const create = vi.spyOn(vault, 'create');
    const createFolder = vi.spyOn(vault, 'createFolder');
    const read = vi.spyOn(vault, 'read');
    const single = await store.deleteArchived(first);
    await store.undoArchiveRemoval(single);
    const all = await store.clearArchive([first, second]);
    await store.undoArchiveRemoval(all);
    expect(create).not.toHaveBeenCalled();
    expect(createFolder).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect([...vault.files.keys()]).toEqual(files);
    expect([...vault.folders.keys()]).toEqual(folders);
    expect(vault.files.get(oldPath)!.text).toBe('Старая копия');
  });

  it('не считает изменение порядка архива конфликтом', async () => {
    const first = await completed('Первая');
    const second = await completed('Вторая');
    const entry = vault.files.get(store.getPath())!;
    entry.text = serializeTasks([second, first]);
    const removal = await store.clearArchive([first, second]);
    expect(parseTasks(entry.text)).toEqual([]);
    expect(removal.tasks).toEqual([first, second]);
  });

  it('не очищает отфильтрованную часть архива и не удаляет активные задачи', async () => {
    const active = await store.add(draft);
    const first = await completed('Первая');
    const second = await completed('Вторая');
    await expect(store.clearArchive([first])).rejects.toThrow('Архив изменился');
    await expect(store.deleteArchived(active)).rejects.toThrow('только выполненную');
    await expect(store.clearArchive([])).rejects.toThrow('пуст');
    expect(parseTasks(vault.files.get(store.getPath())!.text)).toEqual([active, first, second]);
    expect([...vault.files.keys()].some(path => path.includes('.backups/'))).toBe(false);
  });

  it('не меняет файл при ошибке записи', async () => {
    const archived = await completed('Задача');
    vault.failWrite = true;
    await expect(store.deleteArchived(archived)).rejects.toThrow('Нет доступа');
    expect(parseTasks(vault.files.get(store.getPath())!.text)).toEqual([archived]);
  });

  it('сохраняет активные задачи, изменённые перед записью', async () => {
    const active = await store.add({ ...draft, title: 'Активная' });
    const archived = await completed('Архив');
    const process = vault.process.bind(vault);
    vi.spyOn(vault, 'process').mockImplementationOnce(async (file, callback) => {
      vault.files.get(file.path)!.text = serializeTasks([{ ...active, title: 'Изменена извне' }, archived]);
      return process(file, callback);
    });
    await store.clearArchive([archived]);
    expect(parseTasks(vault.files.get(store.getPath())!.text)).toEqual([{ ...active, title: 'Изменена извне' }]);
  });

  it('не удаляет архив при изменении перед записью', async () => {
    const archived = await completed('Архив');
    const changed = { ...archived, title: 'Изменена извне' };
    const process = vault.process.bind(vault);
    vi.spyOn(vault, 'process').mockImplementationOnce(async (file, callback) => {
      vault.files.get(file.path)!.text = serializeTasks([changed]);
      return process(file, callback);
    });
    await expect(store.clearArchive([archived])).rejects.toThrow('Архив изменился');
    expect(parseTasks(vault.files.get(store.getPath())!.text)).toEqual([changed]);
  });

  it('отклоняет очистку, если перед записью появилась новая задача в архиве', async () => {
    const archived = await completed('Архив');
    const extra = { ...archived, id: '00000000-0000-4000-8000-000000000999', title: 'Добавлена извне' };
    const process = vault.process.bind(vault);
    vi.spyOn(vault, 'process').mockImplementationOnce(async (file, callback) => {
      vault.files.get(file.path)!.text = serializeTasks([archived, extra]);
      return process(file, callback);
    });
    await expect(store.clearArchive([archived])).rejects.toThrow('Архив изменился');
    expect(parseTasks(vault.files.get(store.getPath())!.text)).toEqual([archived, extra]);
  });

  it('не изменяет файл, заменённый перед записью', async () => {
    const archived = await completed('Архив');
    const storagePath = store.getPath();
    const process = vault.process.bind(vault);
    vi.spyOn(vault, 'process').mockImplementationOnce(async (file, callback) => {
      vault.files.delete(storagePath);
      await vault.create(storagePath, serializeTasks([archived]));
      return process(file, callback);
    });
    await expect(store.deleteArchived(archived)).rejects.toThrow('Файл задач изменился');
    expect(parseTasks(vault.files.get(storagePath)!.text)).toEqual([archived]);
  });

  it('не изменяет файл, переименованный перед записью', async () => {
    const archived = await completed('Архив');
    const storagePath = store.getPath();
    const process = vault.process.bind(vault);
    vi.spyOn(vault, 'process').mockImplementationOnce(async (file, callback) => {
      const entry = vault.files.get(storagePath)!;
      vault.files.delete(storagePath);
      entry.file.path = 'Дела/Переименован.md';
      vault.files.set(entry.file.path, entry);
      return process(file, callback);
    });
    await expect(store.deleteArchived(archived)).rejects.toThrow('Файл задач изменился');
    expect(parseTasks(vault.files.get('Дела/Переименован.md')!.text)).toEqual([archived]);
  });

  it('отклоняет устаревшую задачу и новую задачу в архиве', async () => {
    const first = await completed('Первая');
    const second = await completed('Вторая');
    const entry = vault.files.get(store.getPath())!;
    const changed = { ...first, note: 'Изменена извне' };
    entry.text = serializeTasks([changed, second]);
    await expect(store.deleteArchived(first)).rejects.toThrow('изменилась');
    await expect(store.clearArchive([first, second])).rejects.toThrow('Архив изменился');
    expect(parseTasks(entry.text)).toEqual([changed, second]);
  });

  it('не очищает архив, если задача извне возвращена в активные', async () => {
    const archived = await completed('Архив');
    const active = { ...archived, completedAt: null };
    const entry = vault.files.get(store.getPath())!;
    entry.text = serializeTasks([active]);
    await expect(store.clearArchive([archived])).rejects.toThrow('Архив изменился');
    expect(parseTasks(entry.text)).toEqual([active]);
  });

  it('не переносит удаление в другой файл, если смена пути уже в очереди', async () => {
    const archived = await completed('Архив');
    const changing = store.setPath('Другой.md');
    const deleting = store.deleteArchived(archived);
    const results = await Promise.allSettled([changing, deleting]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(parseTasks(vault.files.get('Дела/Задачи.md')!.text)).toEqual([archived]);
    expect([...vault.files.keys()].some(path => path.includes('.backups/'))).toBe(false);
  });

  it('отменяет удаление всех задач с сохранением идентификаторов и дат', async () => {
    const active = await store.add(draft);
    const first = await completed('Первая');
    const second = await completed('Вторая');
    const removal = await store.clearArchive([first, second]);
    await store.undoArchiveRemoval(removal);
    expect(parseTasks(vault.files.get(store.getPath())!.text)).toEqual([active, first, second]);
  });

  it('не отменяет частично при конфликте идентификаторов', async () => {
    const first = await completed('Первая');
    const second = await completed('Вторая');
    const removal = await store.clearArchive([first, second]);
    const entry = vault.files.get(store.getPath())!;
    entry.text = serializeTasks([first]);
    await expect(store.undoArchiveRemoval(removal)).rejects.toThrow('уже есть');
    expect(parseTasks(entry.text)).toEqual([first]);
  });

  it('не отменяет удаление в файле, заменённом перед записью', async () => {
    const archived = await completed('Задача');
    const removal = await store.deleteArchived(archived);
    const storagePath = store.getPath();
    const process = vault.process.bind(vault);
    vi.spyOn(vault, 'process').mockImplementationOnce(async (file, callback) => {
      vault.files.delete(storagePath);
      await vault.create(storagePath, serializeTasks([]));
      return process(file, callback);
    });
    await expect(store.undoArchiveRemoval(removal)).rejects.toThrow('Файл задач изменился');
    expect(parseTasks(vault.files.get(storagePath)!.text)).toEqual([]);
  });

  it('не отменяет удаление после смены файла или при смене в очереди', async () => {
    const archived = await completed('Задача');
    const removal = await store.deleteArchived(archived);
    const changing = store.setPath('Другой.md');
    const undo = store.undoArchiveRemoval(removal);
    const results = await Promise.allSettled([changing, undo]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    await expect(store.undoArchiveRemoval(removal)).rejects.toThrow('Файл задач изменился');
    expect(parseTasks(vault.files.get('Другой.md')!.text)).toEqual([]);
  });
});

describe('Ручной порядок', () => {
  const ordered = () => sortActiveTasks(store.getSnapshot().tasks.filter(task => task.important && !task.urgent));
  async function seed() {
    await store.add({ ...draft, title: 'Один' });
    await store.add({ ...draft, title: 'Два' });
    await store.add({ ...draft, title: 'Три' });
    return ordered();
  }

  it('перемещает вверх и вниз и сохраняет порядок после перезапуска', async () => {
    let group = await seed();
    const ids = group.map(task => task.id);
    await store.moveTask(group[2], group[1], 'up', group);
    group = ordered();
    expect(group.map(task => task.id)).toEqual([ids[0], ids[2], ids[1]]);
    expect(group.map(task => task.order)).toEqual([0, 1, 2]);
    await store.moveTask(group[1], group[2], 'down', group);
    expect(ordered().map(task => task.id)).toEqual(ids);
    const restarted = new TaskStore(vault as unknown as Vault, store.getPath());
    await restarted.load();
    expect(sortActiveTasks(restarted.getSnapshot().tasks).map(task => task.id)).toEqual(ids);
    expect(vault.files.get(store.getPath())!.text).toContain('zadachi:version=2');
  });

  it('перемещает к видимому соседу через скрытые поиском задачи', async () => {
    const group = await seed();
    const ids = group.map(task => task.id);
    await store.moveTask(group[2], group[0], 'up', group);
    expect(ordered().map(task => task.id)).toEqual([ids[2], ids[0], ids[1]]);
    const next = ordered();
    await store.moveTask(next[0], next[2], 'down', next);
    expect(ordered().map(task => task.id)).toEqual(ids);
  });

  it('сохраняет внешнюю правку другой группы и заметки соседа', async () => {
    const other = await store.add({ ...draft, title: 'Другая группа', urgent: true });
    const group = await seed();
    const entry = vault.files.get(store.getPath())!;
    entry.text = serializeTasks(parseTasks(entry.text).map(task =>
      task.id === other.id ? { ...task, note: 'Внешняя правка' } :
      task.id === group[1].id ? { ...task, note: 'Новая заметка' } : task));
    await store.moveTask(group[2], group[0], 'up', group);
    const actual = parseTasks(entry.text);
    expect(actual.find(task => task.id === other.id)?.note).toBe('Внешняя правка');
    expect(actual.find(task => task.id === group[1].id)?.note).toBe('Новая заметка');
  });

  it('отклоняет устаревший состав или порядок группы без записи', async () => {
    const group = await seed();
    const entry = vault.files.get(store.getPath())!;
    entry.text = serializeTasks(parseTasks(entry.text).map(task =>
      task.id === group[1].id ? { ...task, order: 0 } : task));
    const changed = entry.text;
    await expect(store.moveTask(group[2], group[0], 'up', group)).rejects.toThrow();
    expect(entry.text).toBe(changed);
    const current = ordered();
    const partial = [current[0], current[2]];
    await expect(store.moveTask(partial[1], partial[0], 'up', partial)).rejects.toThrow();
    expect(entry.text).toBe(changed);
  });

  it('добавляет задачу в конец упорядоченной группы и сохраняет хронологию обычной', async () => {
    const group = await seed();
    await store.moveTask(group[2], group[0], 'up', group);
    const before = ordered().map(task => task.id);
    const added = await store.add({ ...draft, title: 'Новая' });
    expect(ordered().map(task => task.id)).toEqual([...before, added.id]);
    expect(added.order).toBe(3);
    const other = await store.add({ ...draft, urgent: true });
    expect(other.order).toBeUndefined();
  });

  it('сохраняет порядок при редактировании и переносит сменившую приоритет задачу в конец', async () => {
    const group = await seed();
    await store.moveTask(group[2], group[0], 'up', group);
    const before = ordered();
    const updated = await store.update(before[1], { ...draft, title: 'Переименована' });
    expect(updated.order).toBe(before[1].order);
    const newcomer = await store.add({ ...draft, urgent: true });
    await store.update(newcomer, { ...draft, title: 'В эту группу' });
    expect(ordered().at(-1)?.id).toBe(newcomer.id);
    const changing = ordered()[0];
    const moved = await store.update(changing, { ...draft, urgent: true });
    expect(moved.order).toBeUndefined();
  });

  it('возвращает выполненную задачу на сохранённую позицию', async () => {
    const group = await seed();
    await store.moveTask(group[2], group[0], 'up', group);
    const before = ordered();
    const archived = await store.complete(before[1]);
    expect(archived.order).toBe(1);
    const restored = await store.restore(archived);
    expect(ordered().map(task => task.id)).toEqual(before.map(task => task.id));
    expect(restored).toEqual(before[1]);
  });

  it('возвращает старую задачу без порядка в конец упорядоченной группы', async () => {
    const legacy = await store.add({ ...draft, title: 'Старая' });
    const archived = await store.complete(legacy);
    const group = await seed();
    await store.moveTask(group[2], group[0], 'up', group);
    const before = ordered().map(task => task.id);
    const restored = await store.restore(archived);
    expect(ordered().map(task => task.id)).toEqual([...before, legacy.id]);
    expect(restored.order).toBe(before.length);
  });

  it('ограничивает прежнюю позицию размером текущей группы', async () => {
    const group = await seed();
    await store.moveTask(group[2], group[0], 'up', group);
    const ranked = ordered();
    const archived = await store.complete(ranked[2]);
    await store.complete(ranked[1]);
    const restored = await store.restore(archived);
    expect(ordered().map(task => task.id)).toEqual([ranked[0].id, ranked[2].id]);
    expect(restored.order).toBe(1);
  });

  it('отклоняет изменение приоритета задачи из подтверждённой группы', async () => {
    const group = await seed();
    const entry = vault.files.get(store.getPath())!;
    entry.text = serializeTasks(parseTasks(entry.text).map(task =>
      task.id === group[1].id ? { ...task, urgent: true } : task));
    const changed = entry.text;
    await expect(store.moveTask(group[2], group[0], 'up', group)).rejects.toThrow();
    expect(entry.text).toBe(changed);
  });

  it('не записывает порядок в файл, заменённый до атомарного изменения', async () => {
    const group = await seed();
    const storagePath = store.getPath();
    const contents = vault.files.get(storagePath)!.text;
    const process = vault.process.bind(vault);
    vi.spyOn(vault, 'process').mockImplementationOnce(async (file, callback) => {
      vault.files.delete(storagePath);
      await vault.create(storagePath, contents);
      return process(file, callback);
    });
    await expect(store.moveTask(group[2], group[0], 'up', group)).rejects.toThrow('Файл задач изменился');
    expect(vault.files.get(storagePath)!.text).toBe(contents);
  });

  it('не пишет при ошибке файла и не переносит порядок между файлами', async () => {
    const group = await seed();
    const entry = vault.files.get(store.getPath())!;
    const before = entry.text;
    vault.failWrite = true;
    await expect(store.moveTask(group[2], group[0], 'up', group)).rejects.toThrow();
    expect(entry.text).toBe(before);
    vault.failWrite = false;
    const changing = store.setPath('Другой.md');
    const move = store.moveTask(group[2], group[0], 'up', group);
    expect((await Promise.allSettled([changing, move])).map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(entry.text).toBe(before);
  });
});
