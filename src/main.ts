import { getLanguage, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, type Command } from 'obsidian';
import { TaskStore, validateStoragePath } from './store';
import { TaskView } from './view';
import { TaskTab, VIEW_TYPE } from './types';
import { I18n, type LanguagePreference, type MessageKey } from './i18n';
import { isTaskDocument, serializeTasks } from './model';
import { CreateListModal } from './create-list-modal';

interface ZadachiSettings { storagePath: string; language: LanguagePreference }
const DEFAULT_PATH = 'Задачи.md';

export default class ZadachiPlugin extends Plugin {
  settings: ZadachiSettings = { storagePath: DEFAULT_PATH, language: 'auto' };
  i18n = new I18n('auto', getLanguage);
  private readonly stores = new Map<TFile, { service: TaskStore; refs: number; idle?: Promise<void> }>();
  private readonly rawLeaves = new WeakMap<WorkspaceLeaf, TFile>();
  private readonly redirecting = new WeakSet<WorkspaceLeaf>();
  private readonly recognized = new WeakMap<TFile, { mtime: number; size: number; task: boolean }>();
  private readonly taskFiles = new WeakSet<TFile>();
  private stopped = false;
  private ribbonElement: HTMLElement | null = null;
  private readonly localizedCommands: Array<{ command: Command; key: MessageKey }> = [];
  private settingsQueue: Promise<void> = Promise.resolve();
  private renameQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    this.stopped = false;
    const saved: unknown = await this.loadData();
    if (saved && typeof saved === 'object' && 'language' in saved &&
        (saved.language === 'auto' || saved.language === 'ru' || saved.language === 'en')) this.settings.language = saved.language;
    this.i18n.setPreference(this.settings.language);
    if (saved && typeof saved === 'object' && 'storagePath' in saved) {
      try { this.settings.storagePath = validateStoragePath(String(saved.storagePath)); }
      catch {
        new Notice(`${this.i18n.t('pluginName')}: ${this.i18n.t('invalidSavedPath')}`, 10000);
        this.settings.storagePath = String(saved.storagePath);
      }
    }
    this.registerView(VIEW_TYPE, leaf => new TaskView(leaf, null, this.i18n, {
      acquire: file => this.acquireFileStore(file),
      defaultPath: () => this.settings.storagePath,
      openMarkdown: (target, file) => this.openMarkdown(target, file),
    }));
    this.ribbonElement = this.addRibbonIcon('list-checks', this.i18n.t('ribbonOpen'), () => {
      void this.openTasks('active').catch(error => this.showError(error));
    });
    for (const [id, key, tab, focus] of [
      ['open-list', 'commandOpen', 'active', false],
      ['quick-add', 'commandQuickAdd', 'active', true],
      ['open-archive', 'commandArchive', 'archive', false],
    ] as const) {
      const command = this.addCommand({ id, name: this.i18n.t(key), callback: () => {
        void this.openTasks(tab, focus).catch(error => this.showError(error));
      } });
      this.localizedCommands.push({ command, key });
    }
    const createCommand = this.addCommand({ id: 'create-list', name: this.i18n.t('commandCreateList'), callback: () => {
      this.showCreateList(this.app.workspace.getActiveFile()?.parent?.path ?? '');
    } });
    this.localizedCommands.push({ command: createCommand, key: 'commandCreateList' });
    this.refreshLabels();
    this.addSettingTab(new ZadachiSettingTab(this.app, this));

    const onFileChange = (file: { path: string }): void => {
      if (file instanceof TFile) this.recognized.delete(file);
      for (const { service, refs } of this.stores.values()) {
        const path = service.getPath();
        if (refs && (file.path === path || path.startsWith(`${file.path}/`))) void service.load();
      }
      this.scanMarkdownLeaves();
    };
    this.registerEvent(this.app.vault.on('modify', onFileChange));
    this.registerEvent(this.app.vault.on('create', onFileChange));
    this.registerEvent(this.app.vault.on('delete', onFileChange));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const newPath = file.path;
      const renamed = this.renameQueue.then(() => this.followRename(newPath, oldPath));
      this.renameQueue = renamed.catch(error => this.showError(error));
    }));
    this.registerEvent(this.app.workspace.on('file-open', () => this.scanMarkdownLeaves()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => { if (leaf) void this.redirectMarkdownLeaf(leaf); }));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.scanMarkdownLeaves()));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      const folder = file instanceof TFolder ? file.path : file.parent?.path ?? '';
      menu.addItem(item => item.setSection('action-primary').setTitle(this.i18n.t('commandCreateList')).setIcon('list-plus').onClick(() => this.showCreateList(folder)));
      if (file instanceof TFile && this.taskFiles.has(file)) {
        menu.addItem(item => item.setTitle(this.i18n.t('openAsTasks')).setIcon('list-checks').onClick(() => {
          void this.openFile(file).catch(error => this.showError(error));
        }));
      }
    }));
    this.app.workspace.onLayoutReady(() => this.scanMarkdownLeaves());
  }

  onunload(): void {
    this.stopped = true;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const file = (leaf.view as TaskView).file;
      if (file && this.app.vault.getAbstractFileByPath(file.path) === file) {
        void leaf.setViewState({ type: 'markdown', state: { file: file.path }, active: false }).catch(() => undefined);
      }
    }
    this.stores.clear();
  }

  acquireFileStore(file: TFile): { service: TaskStore; release(): void } {
    this.taskFiles.add(file);
    let entry = this.stores.get(file);
    if (!entry) {
      entry = { service: new TaskStore(this.app.vault, file.path, { createIfMissing: false, file }), refs: 0 };
      this.stores.set(file, entry);
    }
    const current = entry;
    current.idle = undefined;
    current.refs++;
    let released = false;
    return { service: current.service, release: () => {
      if (released) return;
      released = true;
      if (--current.refs === 0) {
        const idle = current.idle = current.service.whenIdle();
        void idle.then(() => {
          if (!current.refs && current.idle === idle && this.stores.get(file) === current) this.stores.delete(file);
        });
      }
    } };
  }

  async openTasks(tab: TaskTab, focus = false): Promise<void> {
    const active = this.app.workspace.activeLeaf;
    const activeFile = this.app.workspace.getActiveFile();
    const file = active?.view instanceof TaskView ? active.view.file :
      activeFile && this.taskFiles.has(activeFile) ? activeFile : null;
    if (file) return this.openFile(file, tab, focus);
    const path = validateStoragePath(this.settings.storagePath);
    let selected = this.app.vault.getAbstractFileByPath(path);
    // Only an explicit open command may create the first default list.
    if (!selected) selected = await this.createList(path);
    if (!(selected instanceof TFile)) throw new Error(this.i18n.t('notFile', { path }));
    await this.openFile(selected, tab, focus);
  }

  async openFile(file: TFile, tab: TaskTab = 'active', focus = false): Promise<void> {
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error(this.i18n.t('fileUnavailable'));
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE).find(leaf => (leaf.view as TaskView).file === file);
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      this.rawLeaves.delete(leaf);
      await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof TaskView) {
      leaf.view.selectTab(tab);
      if (focus) leaf.view.focusComposer();
    }
  }

  async openMarkdown(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    this.rawLeaves.set(leaf, file);
    await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source' }, active: true });
  }

  private scanMarkdownLeaves(): void {
    if (this.stopped) return;
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) void this.redirectMarkdownLeaf(leaf);
  }

  async redirectMarkdownLeaf(leaf: WorkspaceLeaf): Promise<void> {
    const view = leaf.view;
    if (this.stopped || view.getViewType() !== 'markdown') return;
    const file = (view as unknown as { file: TFile | null }).file;
    if (!file || file.extension.toLowerCase() !== 'md') return;
    const raw = this.rawLeaves.get(leaf);
    if (raw === file) return;
    if (raw) this.rawLeaves.delete(leaf);
    if (this.redirecting.has(leaf)) return;
    this.redirecting.add(leaf);
    try {
      const stat = file.stat;
      let known = this.recognized.get(file);
      if (!known || known.mtime !== stat.mtime || known.size !== stat.size) {
        const text = await this.app.vault.cachedRead(file);
        known = { mtime: stat.mtime, size: stat.size, task: isTaskDocument(text) };
        this.recognized.set(file, known);
      }
      if (known.task) this.taskFiles.add(file);
      if (!known.task || this.stopped || leaf.view !== view || (view as unknown as { file: TFile | null }).file !== file ||
          this.rawLeaves.get(leaf) === file || this.app.vault.getAbstractFileByPath(file.path) !== file) return;
      await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: false });
    } catch (error) {
      if (!this.stopped) this.showError(error);
    } finally {
      this.redirecting.delete(leaf);
      if (!this.stopped && leaf.view === view && (view as unknown as { file: TFile | null }).file !== file) {
        void this.redirectMarkdownLeaf(leaf);
      }
    }
  }

  suggestListPath(folder: string): string {
    const base = folder && folder !== '/' ? `${folder}/` : '';
    const name = this.i18n.t('newListName');
    for (let index = 0; ; index++) {
      const path = `${base}${name}${index ? ` ${index + 1}` : ''}.md`;
      if (!this.app.vault.getAbstractFileByPath(path)) return path;
    }
  }

  showCreateList(folder: string): void {
    new CreateListModal(this.app, this.i18n, this.suggestListPath(folder), async path => {
      const file = await this.createList(path);
      await this.openFile(file, 'active', true);
    }).open();
  }

  async createList(input: string): Promise<TFile> {
    const path = validateStoragePath(input);
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error(this.i18n.t('listExists', { path }));
    const parts = path.split('/');
    parts.pop();
    let folder = '';
    for (const part of parts) {
      folder = folder ? `${folder}/${part}` : part;
      let existing = this.app.vault.getAbstractFileByPath(folder);
      if (!existing) {
        try { await this.app.vault.createFolder(folder); }
        catch (error) { if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw error; }
        existing = this.app.vault.getAbstractFileByPath(folder);
      }
      if (!(existing instanceof TFolder)) throw new Error(this.i18n.t('folderOccupied', { path: folder }));
    }
    const file = await this.app.vault.create(path, serializeTasks([]));
    this.taskFiles.add(file);
    this.recognized.set(file, { mtime: file.stat.mtime, size: file.stat.size, task: true });
    return file;
  }

  private async followRename(newPath: string, oldPath: string): Promise<void> {
    for (const { service } of [...this.stores.values()]) {
      const path = service.getPath();
      if (path === oldPath || path.startsWith(`${oldPath}/`)) await service.followRename(newPath + path.slice(oldPath.length));
    }
    const path = this.settings.storagePath;
    if (path === oldPath || path.startsWith(`${oldPath}/`)) {
      await this.enqueueSettings(async () => {
        const next = { ...this.settings, storagePath: newPath + path.slice(oldPath.length) };
        await this.saveData(next);
        this.settings = next;
      });
    }
    this.scanMarkdownLeaves();
  }

  async changeStoragePath(value: string): Promise<void> {
    const path = validateStoragePath(value);
    return this.enqueueSettings(async () => {
      const candidate = this.app.vault.getAbstractFileByPath(path);
      const file = candidate instanceof TFile ? candidate : !candidate ? await this.createList(path) : null;
      if (!file) throw new Error(this.i18n.t('notFile', { path }));
      const { service, release } = this.acquireFileStore(file);
      try {
        await service.load();
        const snapshot = service.getSnapshot();
        if (snapshot.error) throw snapshot.errorCause ?? new Error(snapshot.error);
        const next = { ...this.settings, storagePath: path };
        await this.saveData(next);
        this.settings = next;
      } finally { release(); }
    });
  }

  async changeLanguage(language: LanguagePreference): Promise<void> {
    if (language !== 'auto' && language !== 'ru' && language !== 'en') return;
    return this.enqueueSettings(async () => {
      const next = { ...this.settings, language };
      await this.saveData(next);
      this.settings = next;
      this.i18n.setPreference(language);
      this.refreshLabels();
    });
  }

  private enqueueSettings(action: () => Promise<void>): Promise<void> {
    const result = this.settingsQueue.then(action, action);
    this.settingsQueue = result.catch(() => undefined);
    return result;
  }

  private refreshLabels(): void {
    for (const { command, key } of this.localizedCommands) command.name = `${this.i18n.t('pluginName')}: ${this.i18n.t(key)}`;
    this.ribbonElement?.setAttribute('aria-label', this.i18n.t('ribbonOpen'));
  }

  showError(error: unknown): void { new Notice(`${this.i18n.t('pluginName')}: ${this.i18n.error(error)}`, 10000); }
}

class ZadachiSettingTab extends PluginSettingTab {
  private pathDraft: string | null = null;
  constructor(app: ZadachiPlugin['app'], private readonly plugin: ZadachiPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const {i18n} = this.plugin;
    containerEl.empty();
    let draft = this.pathDraft ?? this.plugin.settings.storagePath;
    let saving = false;
    new Setting(containerEl)
      .setName(i18n.t('language'))
      .setDesc(i18n.t('languageDescription'))
      .addDropdown((dropdown) => dropdown
        .addOption('auto', i18n.t('languageAuto'))
        .addOption('ru', i18n.t('languageRussian'))
        .addOption('en', i18n.t('languageEnglish'))
        .setValue(this.plugin.settings.language)
        .onChange(async (value) => {
          dropdown.setDisabled(true);
          try {
            await this.plugin.changeLanguage(value as LanguagePreference);
            this.display();
          } catch (error) {
            dropdown.setValue(this.plugin.settings.language);
            this.plugin.showError(error);
          } finally {
            dropdown.setDisabled(false);
          }
        }));
    const setting = new Setting(containerEl)
      .setName(i18n.t('storageFile'))
      .setDesc(i18n.t('storageDescription', {path: DEFAULT_PATH}))
      .addText((text) => text
        .setPlaceholder(DEFAULT_PATH)
        .setValue(draft)
        .onChange((value) => { draft = value; this.pathDraft = value; }))
      .addButton((button) => button
        .setButtonText(i18n.t('apply'))
        .setCta()
        .onClick(async () => {
          if (saving) return;
          saving = true;
          button.setDisabled(true);
          try {
            await this.plugin.changeStoragePath(draft);
            this.pathDraft = null;
            new Notice(`${i18n.t('pluginName')}: ${i18n.t('storageSelected')}`);
            this.display();
          } catch (error) {
            this.plugin.showError(error);
          } finally {
            saving = false;
            button.setDisabled(false);
          }
        }));
    setting.controlEl.querySelector('input')?.setAttribute('aria-label', i18n.t('storagePathLabel'));
    containerEl.querySelector('select')?.setAttribute('aria-label', i18n.t('language'));
    new Setting(containerEl)
      .setName(i18n.t('openStorage'))
      .setDesc(i18n.t('openStorageDescription'))
      .addButton((button) => button
        .setButtonText(i18n.t('openFile'))
        .onClick(async () => {
          const file = this.app.vault.getAbstractFileByPath(this.plugin.settings.storagePath);
          if (file instanceof TFile) await this.plugin.openMarkdown(this.app.workspace.getLeaf('tab'), file);
          else new Notice(`${i18n.t('pluginName')}: ${i18n.t('fileUnavailable')}`);
        }));
  }
}
