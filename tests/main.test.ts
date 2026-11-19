// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ useRealStore: false, appLanguage: 'ru' }));

vi.mock('obsidian', () => {
  class Plugin {
    app: any;
    commands: any[] = [];
    ribbon: any;
    ribbonEl: HTMLElement | null = null;
    viewFactory: any;
    settingTab: any;
    manifest: any;
    loadData = vi.fn(async () => null);
    saveData = vi.fn(async (_data: unknown) => {});
    constructor(app: any, manifest: any) { this.app = app; this.manifest = { name: 'Zadachi', ...manifest }; }
    registerView(_type: string, factory: any) { this.viewFactory = factory; }
    addRibbonIcon(_icon: string, title: string, callback: any) {
      this.ribbon = callback;
      const element = document.createElement('div');
      element.setAttribute('aria-label', title);
      this.ribbonEl = element;
      return element;
    }
    addCommand(command: any) { this.commands.push(command); return command; }
    addSettingTab(tab: any) { this.settingTab = tab; }
    registerEvent(_event: any) {}
  }
  class PluginSettingTab {
    containerEl = document.createElement('div');
    constructor(public app: any) { (this.containerEl as any).empty = () => this.containerEl.replaceChildren(); }
  }
  class Notice { constructor(_message: unknown) {} }
  class Setting {
    settingEl = document.createElement('div');
    nameEl = document.createElement('div');
    descEl = document.createElement('div');
    controlEl = document.createElement('div');
    constructor(container: HTMLElement) {
      this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
      container.append(this.settingEl);
    }
    setName(name: string) { this.nameEl.textContent = name; return this; }
    setDesc(desc: string) { this.descEl.textContent = desc; return this; }
    addDropdown(callback: (dropdown: any) => void) {
      const element = document.createElement('select');
      this.controlEl.append(element);
      const dropdown = {
        addOption: (value: string, label: string) => { element.add(new Option(label, value)); return dropdown; },
        setValue: (value: string) => { element.value = value; return dropdown; },
        setDisabled: (value: boolean) => { element.disabled = value; return dropdown; },
        onChange: (handler: (value: string) => void) => { element.addEventListener('change', () => handler(element.value)); return dropdown; },
      };
      callback(dropdown);
      return this;
    }
    addText(callback: (text: any) => void) {
      const element = document.createElement('input');
      this.controlEl.append(element);
      const text = {
        setPlaceholder: (value: string) => { element.placeholder = value; return text; },
        setValue: (value: string) => { element.value = value; return text; },
        onChange: (handler: (value: string) => void) => { element.addEventListener('input', () => handler(element.value)); return text; },
      };
      callback(text);
      return this;
    }
    addButton(callback: (button: any) => void) {
      const element = document.createElement('button');
      this.controlEl.append(element);
      const button = {
        setButtonText: (value: string) => { element.textContent = value; return button; },
        setCta: () => button,
        setDisabled: (value: boolean) => { element.disabled = value; return button; },
        onClick: (handler: () => void) => { element.addEventListener('click', handler); return button; },
      };
      callback(button);
      return this;
    }
  }
  class TFile {
    constructor(public path = '') {}
    stat = { mtime: 1, size: 1 };
    get name() { return this.path.split('/').pop() || ''; }
    get basename() { return this.name.replace(/\.md$/i, ''); }
    get extension() { return this.name.split('.').pop() || ''; }
    get parent() { const parts = this.path.split('/'); parts.pop(); return { path: parts.join('/') }; }
  }
  class TFolder { constructor(public path = '') {} }
  class MarkdownView {
    constructor(public leaf: any, public file: TFile | null = null) {}
    getViewType() { return 'markdown'; }
  }
  const normalizePath = (path: string) => path;
  const getLanguage = () => state.appLanguage;
  return { Plugin, PluginSettingTab, Notice, Setting, TFile, TFolder, MarkdownView, normalizePath, getLanguage };
});

describe('Отдельные файлы списков', () => {
  it('не читает закрытый список при запуске и после внешнего изменения', async () => {
    const start = f.workspace.onLayoutReady.mock.calls[0][0] as () => void;
    start();
    const file = f.files.get('Задачи.md') as TFile;
    f.events.modify(file);
    await Promise.resolve();
    expect(f.vault.read).not.toHaveBeenCalled();
    expect(f.vault.cachedRead).not.toHaveBeenCalled();
    expect(f.plugin.stores.size).toBe(0);
  });

  it('освобождает хранилище после закрытия последней вкладки и окончания записи', async () => {
    const file = f.files.get('Задачи.md') as TFile;
    const first = f.plugin.acquireFileStore(file);
    const second = f.plugin.acquireFileStore(file);
    expect(second.service).toBe(first.service);
    first.release();
    f.events.modify(file);
    expect(second.service.load).toHaveBeenCalledOnce();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    second.service.whenIdle.mockReturnValue(pending);
    second.release();
    await Promise.resolve();
    const reopened = f.plugin.acquireFileStore(file);
    expect(reopened.service).toBe(first.service);
    finish();
    await pending;
    f.events.modify(file);
    expect(reopened.service.load).toHaveBeenCalledTimes(2);
    reopened.release();
    await Promise.resolve();
    f.events.modify(file);
    expect(first.service.load).toHaveBeenCalledTimes(2);
    const fresh = f.plugin.acquireFileStore(file);
    expect(fresh.service).not.toBe(first.service);
    fresh.release();
  });

  it('использует одно хранилище на файл и открывает разные списки в отдельных вкладках', async () => {
    const first = new TFile('Первый.md');
    const second = new TFile('Второй.md');
    f.files.set(first.path, first);
    f.files.set(second.path, second);
    const firstStore = f.plugin.acquireFileStore(first).service;
    expect(f.plugin.acquireFileStore(first).service).toBe(firstStore);
    expect(f.plugin.acquireFileStore(second).service).not.toBe(firstStore);
    await f.plugin.openFile(first);
    const firstLeaf = f.leaf;
    expect(firstLeaf.view.file).toBe(first);
    expect(firstLeaf.view.options.acquire(first).service).toBe(firstStore);
    const secondLeaf = f.createLeaf();
    f.workspace.getLeaf.mockReturnValue(secondLeaf);
    await f.plugin.openFile(second, 'archive');
    expect(secondLeaf.view.file).toBe(second);
    expect(secondLeaf.view.options.acquire(second).service).not.toBe(firstStore);
    expect(secondLeaf.view.selectTab).toHaveBeenCalledWith('archive');
    await f.plugin.openFile(first, 'active', true);
    expect(f.workspace.revealLeaf).toHaveBeenLastCalledWith(firstLeaf);
    expect(firstLeaf.view.focusComposer).toHaveBeenCalledOnce();
    expect(firstLeaf.setViewState).toHaveBeenCalledOnce();
    expect(secondLeaf.setViewState).toHaveBeenCalledOnce();
  });

  it('смена файла по умолчанию не привязывает открытую вкладку к другому списку', async () => {
    const first = f.files.get('Задачи.md') as TFile;
    const firstStore = f.plugin.acquireFileStore(first).service;
    await f.plugin.openFile(first);
    const view = f.leaf.view;
    await f.plugin.changeStoragePath('Новый.md');
    expect(f.plugin.settings.storagePath).toBe('Новый.md');
    expect(view.file).toBe(first);
    expect(view.options.acquire(first).service).toBe(firstStore);
    expect(f.plugin.acquireFileStore(f.files.get("Новый.md")).service).not.toBe(firstStore);
    expect(f.leaf.setViewState).toHaveBeenCalledOnce();
  });

  it('изменение одного файла обновляет только его хранилище', () => {
    const first = new TFile('Первый.md');
    const second = new TFile('Второй.md');
    const a = f.plugin.acquireFileStore(first).service;
    const b = f.plugin.acquireFileStore(second).service;
    f.events.modify(first);
    expect(a.load).toHaveBeenCalledOnce();
    expect(b.load).not.toHaveBeenCalled();
  });

  it('открывает только файлы с маркером как список задач', async () => {
    const owned = new TFile('Список.md');
    const ordinary = new TFile('Заметка.md');
    f.files.set(owned.path, owned);
    f.files.set(ordinary.path, ordinary);
    f.contents.set(owned.path, '# Задачи\n<!-- zadachi:version=1 -->\n');
    f.contents.set(ordinary.path, '# Заметка\nТекст\n<!-- zadachi:version=1 -->\n');
    const ownedLeaf = f.leaf;
    const ordinaryLeaf = f.createLeaf();
    ownedLeaf.view = new MarkdownView(ownedLeaf as any, owned);
    ordinaryLeaf.view = new MarkdownView(ordinaryLeaf as any, ordinary);
    f.workspaceEvents['file-open'](owned);
    await vi.waitFor(() => expect(ownedLeaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE, state: { file: owned.path }, active: false }));
    expect(ordinaryLeaf.setViewState).not.toHaveBeenCalled();
    expect(f.vault.cachedRead).toHaveBeenCalledWith(owned);
    expect(f.vault.cachedRead).toHaveBeenCalledWith(ordinary);
  });

  it('не перенаправляет повторно файл, открытый как исходный Markdown', async () => {
    const file = new TFile('Список.md');
    f.files.set(file.path, file);
    f.contents.set(file.path, '# Задачи\n<!-- zadachi:version=1 -->\n');
    await f.plugin.openMarkdown(f.leaf, file);
    expect(f.leaf.setViewState).toHaveBeenCalledWith({ type: 'markdown', state: { file: file.path, mode: 'source' }, active: true });
    f.leaf.setViewState.mockClear();
    await f.plugin.redirectMarkdownLeaf(f.leaf);
    expect(f.leaf.setViewState).not.toHaveBeenCalled();
    expect(f.vault.cachedRead).not.toHaveBeenCalled();
  });

  it('оставляет действие открытия списка в меню после изменения исходного Markdown', async () => {
    const file = new TFile('Другой список.md');
    f.files.set(file.path, file);
    f.plugin.acquireFileStore(file).service;
    await f.plugin.openMarkdown(f.leaf, file);
    f.events.modify(file);
    const entries: Array<{ title?: string; onClick?: () => void }> = [];
    const menu = {
      addItem: (callback: (item: any) => void) => {
        const entry: { title?: string; onClick?: () => void } = {};
        const item = {
          setTitle: (title: string) => { entry.title = title; return item; },
          setIcon: () => item,
          setSection: () => item,
          onClick: (handler: () => void) => { entry.onClick = handler; return item; },
        };
        callback(item);
        entries.push(entry);
      },
    };
    f.workspaceEvents['file-menu'](menu, file);
    const open = entries.find(entry => entry.title === f.plugin.i18n.t('openAsTasks'));
    expect(open?.onClick).toBeTypeOf('function');
    f.leaf.setViewState.mockClear();
    open!.onClick!();
    await vi.waitFor(() => expect(f.leaf.setViewState).toHaveBeenCalledWith({
      type: VIEW_TYPE, state: { file: file.path }, active: true,
    }));
  });

  it('быстрое добавление из исходного Markdown открывает текущий список', async () => {
    const file = new TFile('Другой список.md');
    f.files.set(file.path, file);
    f.plugin.acquireFileStore(file).service;
    await f.plugin.openMarkdown(f.leaf, file);
    f.workspace.activeLeaf = f.leaf;
    f.leaf.setViewState.mockClear();
    f.plugin.commands.find((command: any) => command.id === 'quick-add').callback();
    await vi.waitFor(() => expect(f.leaf.view?.focusComposer).toHaveBeenCalledOnce());
    expect(f.leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE, state: { file: file.path }, active: true });
    expect(f.leaf.view.file).toBe(file);
    expect(f.plugin.settings.storagePath).toBe('Задачи.md');
  });

  it('не меняет вкладку после медленного чтения, если пользователь открыл другой файл', async () => {
    const file = new TFile('Список.md');
    const other = new TFile('Другая.md');
    f.files.set(file.path, file);
    f.files.set(other.path, other);
    f.leaf.view = new MarkdownView(f.leaf as any, file);
    let finish!: (value: string) => void;
    f.vault.cachedRead.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.plugin.redirectMarkdownLeaf(f.leaf);
    f.leaf.view = new MarkdownView(f.leaf as any, other);
    finish('# Задачи\n<!-- zadachi:version=1 -->\n');
    await pending;
    expect(f.leaf.setViewState).not.toHaveBeenCalled();
    expect(f.leaf.view.file).toBe(other);
  });

  it('создаёт новый Markdown-файл списка и не перезаписывает существующий', async () => {
    const file = await f.plugin.createList('Работа/Новый.md');
    expect(f.vault.createFolder).toHaveBeenCalledWith('Работа');
    expect(file.path).toBe('Работа/Новый.md');
    expect(f.contents.get(file.path)).toMatch(/^# Задачи\n<!-- zadachi:version=1 -->\n/);
    const saved = f.contents.get(file.path);
    await expect(f.plugin.createList(file.path)).rejects.toThrow();
    expect(f.contents.get(file.path)).toBe(saved);
    expect(f.vault.create).toHaveBeenCalledOnce();
  });

  it('обновляет оба открытых хранилища при переименовании родительской папки', async () => {
    const first = new TFile('Работа/Первый.md');
    const second = new TFile('Работа/Второй.md');
    f.files.set(first.path, first);
    f.files.set(second.path, second);
    const a = f.plugin.acquireFileStore(first).service;
    const b = f.plugin.acquireFileStore(second).service;
    f.plugin.settings.storagePath = first.path;
    f.events.rename(new TFolder('Проекты'), 'Работа');
    await vi.waitFor(() => expect(f.plugin.settings.storagePath).toBe('Проекты/Первый.md'));
    expect(a.followRename).toHaveBeenCalledWith('Проекты/Первый.md');
    expect(b.followRename).toHaveBeenCalledWith('Проекты/Второй.md');
    expect(f.plugin.acquireFileStore(first).service).toBe(a);
    expect(f.plugin.acquireFileStore(second).service).toBe(b);
  });

  it('последовательно применяет два быстрых переименования одного файла', async () => {
    const file = f.files.get('Задачи.md') as TFile;
    const store = f.plugin.acquireFileStore(file).service;
    let finishFirst!: () => void;
    store.followRename.mockImplementationOnce(async (path: string) => {
      await new Promise<void>(resolve => { finishFirst = resolve; });
      store.path = path;
    });
    f.files.delete(file.path);
    file.path = 'B.md';
    f.files.set(file.path, file);
    f.events.rename(file, 'Задачи.md');
    await vi.waitFor(() => expect(store.followRename).toHaveBeenCalledWith('B.md'));
    f.files.delete(file.path);
    file.path = 'C.md';
    f.files.set(file.path, file);
    f.events.rename(file, 'B.md');
    finishFirst();
    await vi.waitFor(() => expect(f.plugin.settings.storagePath).toBe('C.md'));
    expect(store.followRename.mock.calls.map(([path]: [string]) => path)).toEqual(['B.md', 'C.md']);
    expect(store.getPath()).toBe('C.md');
    expect(f.plugin.acquireFileStore(file).service).toBe(store);
    expect(f.plugin.saveData).toHaveBeenLastCalledWith({ storagePath: 'C.md', language: 'auto' });
  });

  it('при удалении открытого файла показывает ошибку и не создаёт новый файл', async () => {
    state.useRealStore = true;
    try {
      const real = fixture();
      await real.plugin.onload();
      const file = real.files.get('Задачи.md') as TFile;
      const store = real.plugin.acquireFileStore(file).service;
      await store.load();
      expect(store.getSnapshot().error).toBeNull();
      real.files.delete(file.path);
      real.contents.delete(file.path);
      real.events.delete(file);
      await vi.waitFor(() => expect(store.getSnapshot().error).toBeTruthy());
      expect(real.vault.create).not.toHaveBeenCalled();
    } finally {
      state.useRealStore = false;
    }
  });

  it('при выключении плагина возвращает открытые файлы в Markdown', async () => {
    const file = f.files.get('Задачи.md') as TFile;
    await f.plugin.openFile(file);
    f.leaf.setViewState.mockClear();
    f.plugin.onunload();
    expect(f.leaf.setViewState).toHaveBeenCalledWith({ type: 'markdown', state: { file: file.path }, active: false });
    await f.plugin.redirectMarkdownLeaf(f.leaf);
    expect(f.leaf.setViewState).toHaveBeenCalledOnce();
  });
});

vi.mock('../src/store', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/store')>();
  class TaskStore {
    path: string;
    load = vi.fn(async () => {});
    setPath = vi.fn(async (path: string) => { this.path = path; });
    followRename = vi.fn(async (path: string) => { this.path = path; });
    getSnapshot = vi.fn(() => ({ tasks: [], loading: false, error: null }));
    whenIdle = vi.fn(() => Promise.resolve());
    constructor(vault: unknown, path: string, options?: any) {
      this.path = path;
      if (state.useRealStore) return new original.TaskStore(vault as any, path, options) as any;
    }
    getPath() { return this.path; }
  }
  function validateStoragePath(path: string) {
    if (state.useRealStore) return original.validateStoragePath(path);
    if (!path || path.includes('..') || !path.endsWith('.md')) throw new Error('Некорректный путь');
    return path;
  }
  return { TaskStore, validateStoragePath };
});

vi.mock('../src/create-list-modal', () => ({
  CreateListModal: class { open() {} },
}));

vi.mock('../src/view', () => {
  class TaskView {
    selectTab = vi.fn();
    focusComposer = vi.fn();
    file: unknown = null;
    constructor(public leaf: unknown, public service: unknown, public i18n: { t(key: string): string }, public options?: unknown) {}
    getDisplayText() { return this.i18n.t('pluginName'); }
    getViewType() { return 'zadachi-view'; }
  }
  return { TaskView };
});

import ZadachiPlugin from '../src/main';
import { VIEW_TYPE } from '../src/types';
import { MarkdownView, TFile, TFolder } from 'obsidian';

type Fixture = ReturnType<typeof fixture>;
function fixture() {
  const events: Record<string, (...args: any[]) => void> = {};
  const workspaceEvents: Record<string, (...args: any[]) => void> = {};
  const files = new Map<string, TFile | TFolder>();
  const contents = new Map<string, string>();
  files.set('Задачи.md', new TFile('Задачи.md'));
  contents.set('Задачи.md', '# Задачи\n<!-- zadachi:version=1 -->\n');
  const leaves: any[] = [];
  const workspace = {
    activeLeaf: null as any,
    getLeavesOfType: vi.fn((type: string): any[] => leaves.filter(leaf => leaf.view?.getViewType?.() === type)),
    getActiveFile: vi.fn(() => workspace.activeLeaf?.view?.file ?? null),
    getRightLeaf: vi.fn(),
    getLeaf: vi.fn(),
    revealLeaf: vi.fn(async () => {}),
    onLayoutReady: vi.fn(),
    on: vi.fn((name: string, callback: (...args: any[]) => void) => { workspaceEvents[name] = callback; return { name }; }),
  };
  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
    cachedRead: vi.fn(async (file: TFile) => contents.get(file.path) ?? ''),
    read: vi.fn(async (file: TFile) => contents.get(file.path) ?? ''),
    createFolder: vi.fn(async (path: string) => { const folder = new TFolder(path); files.set(path, folder); return folder; }),
    create: vi.fn(async (path: string, text: string) => {
      if (files.has(path)) throw new Error('Файл уже существует');
      const file = new TFile(path); files.set(path, file); contents.set(path, text); return file;
    }),
    process: vi.fn(async (file: TFile, change: (content: string) => string) => {
      const updated = change(contents.get(file.path) ?? ''); contents.set(file.path, updated); return updated;
    }),
    on: vi.fn((name: string, callback: (...args: any[]) => void) => {
      events[name] = callback;
      return { name };
    }),
  };
  const plugin = new ZadachiPlugin({ workspace, vault } as any, {} as any) as any;
  function createLeaf() {
    const leaf = {
      view: null as any,
      setViewState: vi.fn(async (viewState: any) => {
        const file = viewState.state?.file ? files.get(viewState.state.file) : null;
        if (viewState.type === VIEW_TYPE) {
          leaf.view = plugin.viewFactory(leaf);
          leaf.view.file = file ?? null;
        } else if (viewState.type === 'markdown') leaf.view = new MarkdownView(leaf as any, file instanceof TFile ? file : null);
      }),
      getViewState: vi.fn(() => ({ type: leaf.view?.getViewType?.(), state: { file: leaf.view?.file?.path } })),
      openFile: vi.fn(async (file: TFile) => { leaf.view = new MarkdownView(leaf as any, file); }),
    };
    leaves.push(leaf);
    return leaf;
  }
  const leaf = createLeaf();
  workspace.getLeaf.mockReturnValue(leaf);
  return { plugin, workspace, vault, events, workspaceEvents, leaf, leaves, files, contents, createLeaf };
}

let f: Fixture;
beforeEach(async () => { state.useRealStore = false; state.appLanguage = 'ru'; f = fixture(); await f.plugin.onload(); });

describe('Подключение к Obsidian', () => {
  it('регистрирует панель, кнопку ленты и четыре команды', () => {
    expect(f.plugin.viewFactory).toBeTypeOf('function');
    expect(f.plugin.ribbon).toBeTypeOf('function');
    expect(f.plugin.commands.map((command: any) => command.id)).toEqual(['open-list', 'quick-add', 'open-archive', 'create-list']);
    expect(f.workspace.onLayoutReady).toHaveBeenCalledOnce();
  });

  it('команда быстрого добавления открывает панель и фокусирует поле', async () => {
    f.plugin.commands.find((command: any) => command.id === 'quick-add').callback();
    await vi.waitFor(() => expect(f.leaf.view?.focusComposer).toHaveBeenCalledOnce());
    expect(f.leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE, state: { file: 'Задачи.md' }, active: true });
    expect(f.workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(f.workspace.getRightLeaf).not.toHaveBeenCalled();
    expect(f.workspace.revealLeaf).toHaveBeenCalledWith(f.leaf);
    expect(f.leaf.view.selectTab).toHaveBeenCalledWith('active');
  });

  it('обновляет список при изменении выбранного файла', () => {
    const { service } = f.plugin.acquireFileStore(f.files.get('Задачи.md'));
    f.events.modify({ path: 'Чужой.md' });
    expect(service.load).not.toHaveBeenCalled();
    f.events.modify({ path: 'Задачи.md' });
    expect(service.load).toHaveBeenCalledOnce();
  });

  it('сохраняет новый путь при переименовании файла и родительской папки', async () => {
    f.events.rename({ path: 'Рабочие.md' }, 'Задачи.md');
    await vi.waitFor(() => expect(f.plugin.saveData).toHaveBeenCalledWith({ storagePath: 'Рабочие.md', language: 'auto' }));

    await f.plugin.changeStoragePath('Проекты/Рабочие.md');
    f.events.rename({ path: 'Документы' }, 'Проекты');
    await vi.waitFor(() => expect(f.plugin.saveData).toHaveBeenLastCalledWith({ storagePath: 'Документы/Рабочие.md', language: 'auto' }));
  });

  it('сохраняет прежний файл и настройку при отклонённой смене пути', async () => {
    await expect(f.plugin.changeStoragePath('../Задачи.md')).rejects.toThrow('Некорректный путь');
    expect(f.plugin.settings.storagePath).toBe('Задачи.md');
    expect(f.plugin.saveData).not.toHaveBeenCalled();

    const invalid = new TFile('Другие.md');
    f.files.set(invalid.path, invalid);
    f.plugin.acquireFileStore(invalid).service.getSnapshot.mockReturnValueOnce({ tasks: [], loading: false, error: 'Файл повреждён', errorCause: new Error('Файл повреждён') });
    await expect(f.plugin.changeStoragePath('Другие.md')).rejects.toThrow('Файл повреждён');
    expect(f.plugin.settings.storagePath).toBe('Задачи.md');
    expect(f.plugin.saveData).not.toHaveBeenCalled();
  });

  it('загружается с некорректным сохранённым путём и сообщает об ошибке при открытии', async () => {
    state.useRealStore = true;
    try {
      const actual = fixture();
      actual.plugin.loadData.mockResolvedValueOnce({ storagePath: '../чужой.md' });
      await actual.plugin.onload();
      expect(actual.plugin.settingTab).toBeDefined();
      expect(actual.plugin.viewFactory).toBeTypeOf('function');
      expect(actual.plugin.settings.storagePath).toBe('../чужой.md');
      const onLayoutReady = actual.workspace.onLayoutReady.mock.calls[0][0] as () => void;
      onLayoutReady();
      await expect(actual.plugin.openTasks('active')).rejects.toThrow();
      expect(actual.vault.getAbstractFileByPath).not.toHaveBeenCalled();
      expect(actual.plugin.saveData).not.toHaveBeenCalled();
    } finally {
      state.useRealStore = false;
    }
  });

  it('сохраняет прежний путь и автоматически выбирает язык для старых настроек', async () => {
    state.appLanguage = 'en-GB';
    const old = fixture();
    old.plugin.loadData.mockResolvedValueOnce({ storagePath: 'Проекты/Дела.md' });
    await old.plugin.onload();
    expect(old.plugin.settings).toEqual({ storagePath: 'Проекты/Дела.md', language: 'auto' });
    expect(old.plugin.i18n.language).toBe('en');
    expect(old.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(old.plugin.saveData).not.toHaveBeenCalled();
    expect(old.plugin.commands.slice(0, 3).map((command: any) => command.name)).toEqual(['Zadachi: Open task list', 'Zadachi: Quick add', 'Zadachi: Open archive']);
  });

  it('сохраняет выбор языка и обновляет названия команд', async () => {
    expect(f.plugin.i18n.language).toBe('ru');
    await f.plugin.openTasks('active');
    expect(f.leaf.view.getDisplayText()).toBe('Zadachi');
    await f.plugin.changeLanguage('en');
    expect(f.plugin.settings).toEqual({ storagePath: 'Задачи.md', language: 'en' });
    expect(f.plugin.saveData).toHaveBeenLastCalledWith({ storagePath: 'Задачи.md', language: 'en' });
    expect(f.plugin.i18n.language).toBe('en');
    expect(f.plugin.commands.slice(0, 3).map((command: any) => command.name)).toEqual(['Zadachi: Open task list', 'Zadachi: Quick add', 'Zadachi: Open archive']);
    expect(f.plugin.ribbonEl.getAttribute('aria-label')).toBe('Zadachi: open task list');
    expect(f.leaf.view.getDisplayText()).toBe('Zadachi');
    expect(f.leaf.setViewState).toHaveBeenCalledOnce();
  });

  it('использует сохранённый выбор вместо языка приложения', async () => {
    state.appLanguage = 'ru-RU';
    const saved = fixture();
    saved.plugin.loadData.mockResolvedValueOnce({ storagePath: 'Задачи.md', language: 'en' });
    await saved.plugin.onload();
    expect(saved.plugin.i18n.language).toBe('en');
    expect(saved.plugin.commands[1].name).toBe('Zadachi: Quick add');
  });

  it('сохраняет прежний язык и путь, если запись настроек не удалась', async () => {
    f.plugin.saveData.mockRejectedValueOnce(new Error('Ошибка записи'));
    await expect(f.plugin.changeLanguage('en')).rejects.toThrow('Ошибка записи');
    expect(f.plugin.settings).toEqual({ storagePath: 'Задачи.md', language: 'auto' });
    expect(f.plugin.i18n.language).toBe('ru');
    expect(f.plugin.commands[1].name).toBe('Zadachi: Быстро добавить');
  });

  it('переводит настройки после выбора языка и сохраняет черновик пути', async () => {
    f.plugin.settingTab.display();
    const container = f.plugin.settingTab.containerEl as HTMLElement;
    const path = container.querySelector<HTMLInputElement>('input')!;
    path.value = 'Проекты/Черновик.md';
    path.dispatchEvent(new Event('input', { bubbles: true }));
    const language = container.querySelector<HTMLSelectElement>('select')!;
    language.value = 'en';
    language.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(container.textContent).toContain('Interface language'));
    expect(container.querySelector<HTMLInputElement>('input')!.value).toBe('Проекты/Черновик.md');
    expect(container.querySelector<HTMLSelectElement>('select')!.value).toBe('en');
    expect(f.plugin.settings.storagePath).toBe('Задачи.md');
  });

  it('возвращает прежний выбор в настройках при ошибке записи', async () => {
    f.plugin.settingTab.display();
    const container = f.plugin.settingTab.containerEl as HTMLElement;
    const language = container.querySelector<HTMLSelectElement>('select')!;
    f.plugin.saveData.mockRejectedValueOnce(new Error('Ошибка записи'));
    language.value = 'en';
    language.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(language.disabled).toBe(false));
    expect(language.value).toBe('auto');
    expect(f.plugin.i18n.language).toBe('ru');
    expect(container.textContent).toContain('Язык интерфейса');
  });
});
