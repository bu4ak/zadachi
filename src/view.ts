import { EditableFileView, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import type { Menu, TFile, ViewStateResult } from 'obsidian';
import { TaskEditModal } from './edit-modal';
import { ArchiveConfirmModal } from './confirm-modal';
import { I18n, LocalizedError } from './i18n';
import type { MessageKey } from './i18n';
import { sortActiveTasks, sortArchivedTasks } from './model';
import { TaskDrag } from './task-drag';
import { createPriorityToggle } from './priority-toggle';
import type { DragRow } from './task-drag';
import { VIEW_TYPE } from './types';
import type { ArchiveRemoval, Task, TaskDraft, TaskService, TaskTab } from './types';

const GROUPS = [
  { title: 'groupFirst', className: 'first' },
  { title: 'groupUrgent', className: 'urgent' },
  { title: 'groupImportant', className: 'important' },
  { title: 'groupLater', className: 'later' },
] as const;
let nextViewId = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  return createEl(tag, { cls, text });
}

function iconButton(label: string, icon: string, cls: string): HTMLButtonElement {
  const button = el('button', cls);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  setIcon(button, icon);
  return button;
}

function groupIndex(task: Task): number {
  return task.urgent ? (task.important ? 0 : 1) : (task.important ? 2 : 3);
}

interface RowEntry {
  task: Task;
  node: HTMLElement;
  check: HTMLInputElement;
  body: HTMLElement;
  title: HTMLButtonElement;
  note: HTMLElement | null;
  date: HTMLTimeElement | null;
  deleteButton: HTMLButtonElement | null;
  dragHandle: HTMLButtonElement | null;
  dragLabel: HTMLElement | null;
}

interface GroupEntry {
  node: HTMLElement;
  items: HTMLElement;
  count: HTMLElement;
  label: Text;
  toggle: HTMLButtonElement;
}

function setText(node: Node, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

/** Remove absent children first so their neighbours are never moved needlessly. */
function reconcileChildren(parent: HTMLElement, wanted: readonly HTMLElement[]): void {
  const keep = new Set(wanted);
  for (const child of Array.from(parent.children)) {
    if (!keep.has(child as HTMLElement)) child.remove();
  }
  if (parent.childElementCount === wanted.length) {
    let child = parent.firstElementChild;
    if (wanted.every(node => {
      if (child !== node) return false;
      child = node.nextElementSibling;
      return true;
    })) return;
  }
  // Keep a longest ordered subsequence in place. This avoids moving focused
  // neighbours when a single task moves from the beginning to the end.
  const positions = new Map(Array.from(parent.children, (node, index) => [node, index]));
  const tails: number[] = [];
  const tailIndexes: number[] = [];
  const previous = new Array<number>(wanted.length).fill(-1);
  wanted.forEach((node, index) => {
    const position = positions.get(node);
    if (position === undefined) return;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (tails[mid] < position) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[index] = tailIndexes[low - 1];
    tails[low] = position;
    tailIndexes[low] = index;
  });
  const stationary = new Set<number>();
  let index = tailIndexes[tails.length - 1] ?? -1;
  while (index !== -1) {
    stationary.add(index);
    index = previous[index];
  }
  let anchor: Element | null = null;
  for (let i = wanted.length - 1; i >= 0; i--) {
    const child = wanted[i];
    if (!stationary.has(i) && (child.parentElement !== parent || child.nextElementSibling !== anchor)) {
      parent.insertBefore(child, anchor);
    }
    anchor = child;
  }
}

export interface TaskFileServices {
  acquire(file: TFile): { service: TaskService; release: () => void };
  defaultPath(): string;
  openMarkdown(leaf: WorkspaceLeaf, file: TFile): Promise<void>;
}

export class TaskView extends EditableFileView {
  private tab: TaskTab = 'active';
  private readonly viewId = ++nextViewId;
  private nextHandleId = 0;
  private unsub: (() => void) | null = null;
  private unsubLocale: (() => void) | null = null;
  private binding: { file: TFile; service: TaskService; release(): void } | null = null;
  private closed = true;
  private generation = 0;
  private adding = false;
  private composing = false;
  private compositionEnter = false;
  private readonly busy = new Set<string>();
  private moving = false;
  private drag: TaskDrag | null = null;
  private movePreview: string[] | null = null;
  private archiveRemoving = false;
  private archiveDialog: ArchiveConfirmModal | null = null;
  private readonly editDialogs = new Set<TaskEditModal>();
  private readonly rows = new Map<string, RowEntry>();
  private readonly groups = new Map<number, GroupEntry>();
  private readonly collapsedGroups = new Set<number>();
  private readonly searchCollapsedGroups = new Set<number>();
  private archiveItems: HTMLElement | null = null;
  private emptyNode: HTMLElement | null = null;
  private statusKey = '';
  private urgent = false;
  private important = false;
  private root!: HTMLElement;
  private input!: HTMLInputElement;
  private addButton!: HTMLButtonElement;
  private addLabel!: HTMLElement;
  private urgentButton!: HTMLButtonElement;
  private importantButton!: HTMLButtonElement;
  private activeTab!: HTMLButtonElement;
  private archiveTab!: HTMLButtonElement;
  private tabs!: HTMLElement;
  private activeCount!: HTMLElement;
  private archiveCount!: HTMLElement;
  private searchButton!: HTMLButtonElement;
  private archiveActions!: HTMLElement;
  private clearArchiveButton!: HTMLButtonElement;
  private searchWrap!: HTMLElement;
  private search!: HTMLInputElement;
  private status!: HTMLElement;
  private list!: HTMLElement;
  private announcement!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly standalone: TaskService | null, private readonly i18n = new I18n('ru'), private readonly files?: TaskFileServices) {
    super(leaf);
  }

  private get service(): TaskService {
    const service = this.binding?.service ?? this.standalone;
    if (!service) throw new Error('No task list is open');
    return service;
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.file?.basename || this.i18n.t('pluginName'); }
  getIcon(): string { return 'list-checks'; }

  canAcceptExtension(_extension: string): boolean { return false; }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const next = state && typeof state === 'object' ? state as Record<string, unknown> : {};
    await super.setState(this.files && !('file' in next) ? { ...next, file: this.files.defaultPath() } : next, result);
  }

  async onLoadFile(file: TFile): Promise<void> {
    if (!this.files) return;
    this.detachFile();
    const generation = this.generation;
    this.file = file;
    const acquired = this.files.acquire(file);
    this.binding = { file, ...acquired };
    if (!this.closed) {
      this.unsub = this.service.subscribe(() => { this.cancelDrag(); this.render(); });
      this.render();
    }
    try {
      await acquired.service.load();
    } catch (reason) {
      if (generation === this.generation && !this.closed) this.showError(reason);
    }
    if (generation === this.generation && !this.closed) this.render();
  }

  async onUnloadFile(file: TFile): Promise<void> {
    if (!this.files || (this.binding && this.binding.file !== file)) return;
    this.detachFile();
    if (this.file === file) this.file = null;
    if (!this.closed) this.render();
  }

  async onRename(file: TFile): Promise<void> {
    await super.onRename(file);
  }

  onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    const file = this.file;
    if (this.files && file) menu.addItem(item => item.setTitle(this.i18n.t('openMarkdown')).setIcon('file-text').onClick(() => {
      void this.files!.openMarkdown(this.leaf, file).catch(reason => this.showError(reason));
    }));
  }

  private detachFile(): void {
    this.generation++;
    this.cancelDrag();
    this.unsub?.();
    this.unsub = null;
    this.binding?.release();
    this.binding = null;
    this.archiveDialog?.close();
    this.archiveDialog = null;
    for (const dialog of this.editDialogs) dialog.close();
    this.editDialogs.clear();
    this.busy.clear();
    this.moving = false;
    this.movePreview = null;
    this.archiveRemoving = false;
    this.adding = false;
    this.composing = false;
    this.compositionEnter = false;
    this.urgent = false;
    this.important = false;
    this.tab = 'active';
    this.rows.clear();
    this.groups.clear();
    this.collapsedGroups.clear();
    this.searchCollapsedGroups.clear();
    this.archiveItems = null;
    this.emptyNode = null;
    this.statusKey = '';
    if (!this.closed && this.root) {
      this.input.value = '';
      this.input.disabled = false;
      this.urgentButton.setAttribute('aria-pressed', 'false');
      this.importantButton.setAttribute('aria-pressed', 'false');
      this.search.value = '';
      this.searchWrap.hidden = true;
      this.searchButton.setAttribute('aria-expanded', 'false');
      this.list.replaceChildren();
      this.status.replaceChildren();
      this.announcement.replaceChildren();
    }
  }

  async onOpen(): Promise<void> {
    this.closed = false;
    this.generation++;
    this.containerEl.children[1].replaceChildren();
    this.root = el('div', 'zadachi-view');
    this.containerEl.children[1].appendChild(this.root);

    const composer = el('form', 'zadachi-composer');
    const entry = el('div', 'zadachi-composer-entry');
    this.input = el('input', 'zadachi-input');
    this.input.type = 'text';
    this.input.placeholder = this.i18n.t('composerPlaceholder');
    this.input.setAttribute('aria-label', this.i18n.t('composerLabel'));
    this.input.autocomplete = 'off';
    this.input.addEventListener('compositionstart', () => { this.composing = true; });
    this.input.addEventListener('compositionend', () => { this.composing = false; });
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.isComposing || this.composing)) {
        // Let the input method accept the character, but ignore a simultaneous submit.
        this.compositionEnter = true;
        this.input.ownerDocument.defaultView?.setTimeout(() => { this.compositionEnter = false; }, 0);
      }
    });
    this.addButton = iconButton(this.i18n.t('addTask'), 'plus', 'zadachi-add mod-cta');
    this.addButton.type = 'submit';
    this.addLabel = el('span', 'zadachi-add-label', this.i18n.t('addShort'));
    const enterHint = el('span', 'zadachi-add-hint', '↵');
    enterHint.setAttribute('aria-hidden', 'true');
    this.addButton.append(this.addLabel, enterHint);
    entry.append(this.input, this.addButton);
    const flags = el('div', 'zadachi-compose-flags');
    this.urgentButton = this.flagButton(this.i18n.t('urgent'), 'urgent');
    this.importantButton = this.flagButton(this.i18n.t('important'), 'important');
    flags.append(this.urgentButton, this.importantButton);
    composer.append(entry, flags);
    composer.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.composing || this.compositionEnter) return;
      void this.add();
    });

    const toolbar = el('div', 'zadachi-toolbar');
    const tabs = el('div', 'zadachi-tabs');
    this.tabs = tabs;
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', this.i18n.t('taskList'));
    this.activeTab = el('button', 'zadachi-tab');
    this.activeTab.type = 'button';
    this.activeTab.setAttribute('role', 'tab');
    this.activeTab.id = `zadachi-active-${this.viewId}`;
    this.activeTab.setAttribute('aria-controls', `zadachi-panel-${this.viewId}`);
    this.activeTab.append(this.i18n.t('active'));
    this.activeCount = el('span', 'zadachi-tab-count', '0');
    this.activeTab.appendChild(this.activeCount);
    this.activeTab.addEventListener('click', () => this.selectTab('active'));
    this.archiveTab = el('button', 'zadachi-tab');
    this.archiveTab.type = 'button';
    this.archiveTab.setAttribute('role', 'tab');
    this.archiveTab.id = `zadachi-archive-${this.viewId}`;
    this.archiveTab.setAttribute('aria-controls', `zadachi-panel-${this.viewId}`);
    this.archiveTab.append(this.i18n.t('archive'));
    this.archiveCount = el('span', 'zadachi-tab-count', '0');
    this.archiveTab.appendChild(this.archiveCount);
    this.archiveTab.addEventListener('click', () => this.selectTab('archive'));
    tabs.append(this.activeTab, this.archiveTab);
    tabs.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      this.selectTab(this.tab === 'active' ? 'archive' : 'active');
      (this.tab === 'active' ? this.activeTab : this.archiveTab).focus();
    });
    this.searchButton = iconButton(this.i18n.t('searchOpen'), 'search', 'zadachi-search-toggle clickable-icon');
    this.searchButton.setAttribute('aria-expanded', 'false');
    this.searchButton.addEventListener('click', () => this.toggleSearch());
    toolbar.append(tabs, this.searchButton);

    this.archiveActions = el('div', 'zadachi-archive-actions');
    this.clearArchiveButton = el('button', 'zadachi-clear-archive', this.i18n.t('clearArchive'));
    this.clearArchiveButton.type = 'button';
    this.clearArchiveButton.addEventListener('click', () => this.openArchiveDialog('all'));
    this.archiveActions.appendChild(this.clearArchiveButton);

    this.searchWrap = el('div', 'zadachi-search');
    this.searchWrap.hidden = true;
    this.search = el('input', 'zadachi-search-input');
    this.search.type = 'search';
    this.search.placeholder = this.i18n.t('searchPlaceholder');
    this.search.setAttribute('aria-label', this.i18n.t('searchLabel'));
    this.search.addEventListener('focus', () => {
      this.searchWrap.hidden = false;
      this.searchButton.setAttribute('aria-expanded', 'true');
    });
    this.search.addEventListener('input', () => {
      this.cancelDrag();
      this.searchWrap.hidden = false;
      this.searchButton.setAttribute('aria-expanded', 'true');
      this.searchCollapsedGroups.clear();
      this.render();
    });
    this.search.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.toggleSearch(false);
      const inlineSearch = this.searchButton.ownerDocument.defaultView?.getComputedStyle(this.searchButton).display === 'none';
      (inlineSearch ? this.search : this.searchButton).focus();
    });
    this.searchWrap.appendChild(this.search);
    toolbar.appendChild(this.searchWrap);

    this.status = el('div', 'zadachi-status');
    this.status.setAttribute('role', 'status');
    this.list = el('div', 'zadachi-list');
    this.list.setAttribute('role', 'tabpanel');
    this.list.id = `zadachi-panel-${this.viewId}`;
    this.announcement = el('div', 'zadachi-sr-only');
    this.announcement.setAttribute('role', 'status');
    this.announcement.setAttribute('aria-live', 'polite');
    this.root.append(composer, toolbar, this.archiveActions, this.status, this.list, this.announcement);
    if (!this.files || this.binding) this.unsub = this.service.subscribe(() => { this.cancelDrag(); this.render(); });
    this.unsubLocale = this.i18n.subscribe(() => { this.cancelDrag(); this.render(); });
    this.render();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.detachFile();
    this.unsubLocale?.();
    this.unsubLocale = null;
    this.root?.replaceChildren();
    this.rows.clear();
    this.groups.clear();
    this.archiveItems = null;
    this.emptyNode = null;
    this.statusKey = '';
  }

  selectTab(tab: TaskTab): void {
    this.cancelDrag();
    this.tab = tab;
    if (!this.closed) this.render();
  }

  focusComposer(): void {
    if (!this.closed) this.input.focus();
  }

  private flagButton(label: string, flag: 'urgent' | 'important'): HTMLButtonElement {
    return createPriorityToggle(flag, label, this[flag], pressed => { this[flag] = pressed; }).button;
  }

  private async add(): Promise<void> {
    if ((this.files && !this.binding) || this.adding || this.service.getSnapshot().loading || this.service.getSnapshot().error) return;
    const generation = this.generation;
    const service = this.service;
    const title = this.input.value.trim();
    if (!title) {
      this.input.focus();
      return;
    }
    const draft: TaskDraft = { title, note: '', urgent: this.urgent, important: this.important };
    this.adding = true;
    this.input.disabled = true;
    this.addButton.disabled = true;
    this.urgentButton.disabled = true;
    this.importantButton.disabled = true;
    try {
      await service.add(draft);
      if (this.closed || generation !== this.generation) return;
      this.input.value = '';
      this.urgent = false;
      this.important = false;
      this.urgentButton.setAttribute('aria-pressed', 'false');
      this.importantButton.setAttribute('aria-pressed', 'false');
    } catch (reason) {
      this.showError(reason);
    } finally {
      if (!this.closed && generation === this.generation) {
        this.adding = false;
        this.input.disabled = false;
        this.addButton.disabled = false;
        this.urgentButton.disabled = false;
        this.importantButton.disabled = false;
        this.input.focus();
        this.render();
      }
    }
  }

  private toggleSearch(open = this.searchWrap.hidden): void {
    this.cancelDrag();
    this.searchWrap.hidden = !open;
    this.searchButton.setAttribute('aria-expanded', String(open));
    this.searchButton.setAttribute('aria-label', this.i18n.t(open ? 'searchClose' : 'searchOpen'));
    this.searchButton.title = this.i18n.t(open ? 'searchClose' : 'searchOpen');
    if (open) this.search.focus();
    else {
      this.search.value = '';
      this.render();
    }
  }

  private render(): void {
    if (this.closed) return;
    this.updateLabels();
    if (this.files && !this.binding) {
      this.input.disabled = true;
      this.addButton.disabled = true;
      this.urgentButton.disabled = true;
      this.importantButton.disabled = true;
      return;
    }
    if (!this.adding) this.input.disabled = false;
    const focused = this.list.contains(this.list.ownerDocument.activeElement)
      ? this.list.ownerDocument.activeElement as HTMLElement : null;
    const snapshot = this.service.getSnapshot();
    this.list.setAttribute('aria-labelledby', this.tab === 'active' ? this.activeTab.id : this.archiveTab.id);
    const active = snapshot.tasks.filter((task) => task.completedAt === null);
    const archive = snapshot.tasks.filter((task) => task.completedAt !== null);
    setText(this.activeCount, String(active.length));
    setText(this.archiveCount, String(archive.length));
    for (const [button, isSelected] of [[this.activeTab, this.tab === 'active'], [this.archiveTab, this.tab === 'archive']] as const) {
      button.setAttribute('aria-selected', String(isSelected));
      button.tabIndex = isSelected ? 0 : -1;
      button.classList.toggle('is-active', isSelected);
    }
    const blocked = snapshot.loading || !!snapshot.error;
    this.archiveActions.hidden = this.tab !== 'archive';
    this.clearArchiveButton.disabled = blocked || this.archiveRemoving || this.moving || this.busy.size > 0 || archive.length === 0;
    this.addButton.disabled = blocked || this.adding;
    this.urgentButton.disabled = blocked || this.adding;
    this.importantButton.disabled = blocked || this.adding;
    const statusKey = snapshot.loading ? `${this.i18n.language}:loading` : snapshot.error ? `${this.i18n.language}:error:${snapshot.error}` : '';
    if (statusKey !== this.statusKey) {
      this.statusKey = statusKey;
      this.status.replaceChildren();
      if (snapshot.loading) this.status.textContent = this.i18n.t('loading');
      else if (snapshot.error) {
        this.status.appendChild(el('span', 'zadachi-status-error', this.i18n.error(snapshot.errorCause ?? snapshot.error)));
        const retry = el('button', 'zadachi-retry', this.i18n.t('retry'));
        retry.type = 'button';
        retry.addEventListener('click', () => void this.service.load().catch((reason: unknown) => this.showError(reason)));
        this.status.appendChild(retry);
      }
    }
    const query = this.search.value.trim().toLocaleLowerCase();
    const matches = (task: Task) => !query || `${task.title}\n${task.note}`.toLocaleLowerCase().includes(query);
    const visible: HTMLElement[] = [];
    const rendered = new Set<HTMLElement>();
    const renderRow = (task: Task, movement?: { up: boolean; down: boolean }) => {
      const node = this.taskRow(task, blocked, movement);
      rendered.add(node);
      return node;
    };
    if (this.tab === 'active') {
      const buckets: Task[][] = GROUPS.map(() => []);
      for (const task of sortActiveTasks(query ? active.filter(matches) : active)) buckets[groupIndex(task)].push(task);
      const rank = this.movePreview && new Map(this.movePreview.map((id, position) => [id, position]));
      const plans: Array<{ group: GroupEntry; rows: HTMLElement[] }> = [];
      for (let index = 0; index < GROUPS.length; index++) {
        const tasks = buckets[index];
        if (rank && tasks.some(task => rank.has(task.id))) {
          tasks.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
        }
        if (!tasks.length) continue;
        const group = this.getGroup(index);
        setText(group.label, this.i18n.t(GROUPS[index].title));
        setText(group.count, String(tasks.length));
        const collapsed = (query ? this.searchCollapsedGroups : this.collapsedGroups).has(index);
        group.items.hidden = collapsed;
        group.toggle.setAttribute('aria-expanded', String(!collapsed));
        plans.push({ group, rows: collapsed ? [] : tasks.map((task, position) => renderRow(task, { up: position > 0, down: position < tasks.length - 1 })) });
        visible.push(group.node);
      }
      // Attach destination groups before moving a task out of an old group.
      // Drop empty groups only after all surviving rows have been transferred.
      for (const { group } of plans) {
        if (group.node.parentElement !== this.list) this.list.appendChild(group.node);
      }
      for (const { group, rows } of plans) {
        let anchor: HTMLElement | null = null;
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i];
          if (row.parentElement !== group.items) group.items.insertBefore(row, anchor);
          anchor = row;
        }
      }
      for (const { group, rows } of plans) reconcileChildren(group.items, rows);
      if (!visible.length && !snapshot.loading && !snapshot.error) visible.push(this.empty(this.i18n.t(query ? 'noResults' : 'noActive')));
    } else {
      const tasks = sortArchivedTasks(query ? archive.filter(matches) : archive);
      if (tasks.length) {
        this.archiveItems ??= el('div', 'zadachi-items zadachi-archive-items');
        reconcileChildren(this.archiveItems, tasks.map(task => renderRow(task)));
        visible.push(this.archiveItems);
      } else if (!snapshot.loading && !snapshot.error) visible.push(this.empty(this.i18n.t(query ? 'noResults' : 'noArchive')));
    }
    for (const [id, row] of this.rows) {
      if (!rendered.has(row.node)) {
        row.node.remove();
        this.rows.delete(id);
      }
    }
    reconcileChildren(this.list, visible);
    if (focused && this.list.contains(focused) && this.list.ownerDocument.activeElement !== focused) {
      focused.focus({ preventScroll: true });
    }
  }

  private updateLabels(): void {
    const t = (key: MessageKey) => this.i18n.t(key);
    this.input.placeholder = t('composerPlaceholder');
    this.input.setAttribute('aria-label', t('composerLabel'));
    this.addButton.setAttribute('aria-label', t('addTask'));
    this.addButton.title = t('addTask');
    setText(this.addLabel, t('addShort'));
    if (this.urgentButton.lastChild) setText(this.urgentButton.lastChild, t('urgent'));
    if (this.importantButton.lastChild) setText(this.importantButton.lastChild, t('important'));
    this.tabs.setAttribute('aria-label', t('taskList'));
    if (this.activeTab.firstChild) setText(this.activeTab.firstChild, t('active'));
    if (this.archiveTab.firstChild) setText(this.archiveTab.firstChild, t('archive'));
    const searchLabel = t(this.searchWrap.hidden ? 'searchOpen' : 'searchClose');
    this.searchButton.setAttribute('aria-label', searchLabel);
    this.searchButton.title = searchLabel;
    this.search.placeholder = t('searchPlaceholder');
    this.search.setAttribute('aria-label', t('searchLabel'));
    setText(this.clearArchiveButton, t('clearArchive'));
  }

  private getGroup(index: number): GroupEntry {
    const existing = this.groups.get(index);
    if (existing) return existing;
    const node = el('section', `zadachi-group zadachi-group-${GROUPS[index].className}`);
    const heading = el('h3', 'zadachi-group-heading');
    const dot = el('span', 'zadachi-group-dot');
    dot.setAttribute('aria-hidden', 'true');
    const count = el('span', 'zadachi-group-count');
    const label = node.ownerDocument.createTextNode(this.i18n.t(GROUPS[index].title));
    const toggle = el('button', 'zadachi-group-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'true');
    const chevron = el('span', 'zadachi-group-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    setIcon(chevron, 'chevron-down');
    toggle.append(chevron, dot, label, count);
    heading.appendChild(toggle);
    const items = el('div', 'zadachi-items');
    items.id = `zadachi-group-items-${this.viewId}-${index}`;
    toggle.setAttribute('aria-controls', items.id);
    toggle.addEventListener('click', () => {
      this.cancelDrag();
      const collapsed = this.search.value.trim() ? this.searchCollapsedGroups : this.collapsedGroups;
      if (collapsed.has(index)) collapsed.delete(index);
      else collapsed.add(index);
      this.render();
    });
    node.append(heading, items);
    const group = { node, items, count, label, toggle };
    this.groups.set(index, group);
    return group;
  }

  private taskRow(task: Task, blocked: boolean, movement?: { up: boolean; down: boolean }): HTMLElement {
    let entry = this.rows.get(task.id);
    if (!entry) {
      entry = this.createTaskRow(task);
      this.rows.set(task.id, entry);
    }
    entry.task = task;
    const archive = task.completedAt !== null;
    entry.check.checked = archive;
    const busy = this.busy.has(task.id) || this.archiveRemoving;
    entry.check.disabled = blocked || busy;
    entry.check.setAttribute('aria-label', this.i18n.t(archive ? 'restoreTask' : 'completeTask', { title: task.title }));
    entry.title.disabled = blocked || busy;
    entry.body.classList.toggle('is-disabled', entry.title.disabled);
    setText(entry.title, task.title);
    entry.title.setAttribute('aria-label', this.i18n.t('editTaskLabel', { title: task.title }));
    if (task.note) {
      if (!entry.note) {
        entry.note = el('div', 'zadachi-task-note');
        entry.body.insertBefore(entry.note, entry.date);
      }
      setText(entry.note, task.note.replace(/\s+/g, ' ').trim());
    } else if (entry.note) {
      entry.note.remove();
      entry.note = null;
    }
    if (task.completedAt) {
      if (!entry.date) {
        entry.date = el('time', 'zadachi-task-date');
        entry.body.appendChild(entry.date);
      }
      if (entry.date.dateTime !== task.completedAt) entry.date.dateTime = task.completedAt;
      setText(entry.date, this.i18n.t('completedOn', { date: this.i18n.formatDate(task.completedAt) }));
    } else if (entry.date) {
      entry.date.remove();
      entry.date = null;
    }
    if (archive) {
      entry.dragHandle?.remove();
      if (!entry.deleteButton) {
        const button = iconButton('', 'trash-2', 'zadachi-delete-archived clickable-icon');
        button.addEventListener('click', () => this.openArchiveDialog('single', entry.task));
        entry.deleteButton = button;
      }
      const label = this.i18n.t('deleteArchivedTask', { title: task.title });
      entry.deleteButton.setAttribute('aria-label', label);
      entry.deleteButton.title = label;
      entry.deleteButton.disabled = blocked || busy;
      if (entry.deleteButton.parentElement !== entry.node) entry.node.appendChild(entry.deleteButton);
    } else {
      entry.deleteButton?.remove();
      if (!entry.dragHandle) {
        const handle = el('button', 'zadachi-drag-handle clickable-icon');
        handle.type = 'button';
        setIcon(handle, 'grip-vertical');
        const label = el('span', 'zadachi-sr-only');
        label.id = `zadachi-drag-label-${this.viewId}-${++this.nextHandleId}`;
        handle.appendChild(label);
        handle.setAttribute('aria-labelledby', label.id);
        handle.addEventListener('pointerdown', event => this.startDrag(entry, event));
        // Keep Obsidian's pull-down quick action from handling a drag on this grip.
        handle.addEventListener('touchstart', event => {
          if (!handle.disabled) event.stopPropagation();
        }, { passive: true });
        handle.addEventListener('keydown', event => {
          if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
          event.preventDefault();
          void this.moveTask(entry, event.key === 'ArrowUp' ? 'up' : 'down');
        });
        entry.dragHandle = handle;
        entry.dragLabel = label;
      }
      const label = this.i18n.t('dragTask', { title: task.title });
      setText(entry.dragLabel!, label);
      entry.dragHandle.setAttribute('aria-description', this.i18n.t('dragKeyboardHelp'));
      entry.dragHandle.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
      entry.dragHandle.disabled = blocked || busy || this.moving || !(movement?.up || movement?.down);
      if (entry.dragHandle.parentElement !== entry.node) entry.node.appendChild(entry.dragHandle);
    }
    return entry.node;
  }

  private createTaskRow(task: Task): RowEntry {
    const row = el('div', 'zadachi-row');
    row.dataset.taskId = task.id;
    const checkTarget = el('label', 'zadachi-check-target');
    const check = el('input', 'zadachi-check');
    check.type = 'checkbox';
    checkTarget.appendChild(check);
    const body = el('div', 'zadachi-task-body');
    const title = el('button', 'zadachi-task-title');
    title.type = 'button';
    body.appendChild(title);
    row.append(checkTarget, body);
    const entry: RowEntry = { task, node: row, check, body, title, note: null, date: null, deleteButton: null, dragHandle: null, dragLabel: null };
    check.addEventListener('change', () => void this.toggleTask(entry.task, check));
    title.addEventListener('click', () => {
      const dialog = new TaskEditModal(this.app, this.service, entry.task, this.i18n, () => this.editDialogs.delete(dialog));
      this.editDialogs.add(dialog);
      dialog.open();
    });
    body.addEventListener('click', event => {
      if (!title.disabled && !title.contains(event.target as Node)) title.click();
    });
    return entry;
  }

  private async moveTask(entry: RowEntry, direction: 'up' | 'down'): Promise<void> {
    const snapshot = this.service.getSnapshot();
    if (this.closed || this.tab !== 'active' || this.moving || this.archiveRemoving || this.busy.size || snapshot.loading || snapshot.error) return;
    const task = { ...entry.task };
    const group = sortActiveTasks(snapshot.tasks.filter(item => item.completedAt === null && item.urgent === task.urgent && item.important === task.important)).map(item => ({ ...item }));
    const query = this.search.value.trim().toLocaleLowerCase();
    const visible = group.filter(item => !query || `${item.title}\n${item.note}`.toLocaleLowerCase().includes(query));
    const index = visible.findIndex(item => item.id === task.id);
    const anchor = index < 0 ? undefined : visible[index + (direction === 'up' ? -1 : 1)];
    if (!anchor) return;
    await this.performMove(entry, task, anchor, direction, group, this.service.getPath());
  }

  private startDrag(entry: RowEntry, event: PointerEvent): void {
    const snapshot = this.service.getSnapshot();
    if (event.isPrimary === false || event.button !== 0 || this.drag || this.closed || this.tab !== 'active' ||
        this.moving || this.archiveRemoving || this.busy.size || snapshot.loading || snapshot.error) return;
    const task = { ...entry.task };
    const group = sortActiveTasks(snapshot.tasks.filter(item => item.completedAt === null && item.urgent === task.urgent && item.important === task.important)).map(item => ({ ...item }));
    const query = this.search.value.trim().toLocaleLowerCase();
    const visible = group.filter(item => !query || `${item.title}\n${item.note}`.toLocaleLowerCase().includes(query));
    if (visible.length < 2) return;
    const rows: DragRow[] = visible.map(item => ({ id: item.id, node: this.rows.get(item.id)!.node }));
    const service = this.service;
    const generation = this.generation;
    const path = service.getPath();
    this.drag = new TaskDrag(entry.dragHandle!, { id: task.id, node: entry.node }, rows, this.root.parentElement!, event, target => {
      const anchor = group.find(item => item.id === target.anchorId);
      if (anchor && this.generation === generation && this.service === service && service.getPath() === path) void this.performMove(entry, task, anchor, target.direction, group, path);
    }, () => { this.drag = null; });
  }

  private cancelDrag(): void {
    this.drag?.cancel();
    this.drag = null;
  }

  private async performMove(entry: RowEntry, task: Task, anchor: Task, direction: 'up' | 'down', group: Task[], path: string): Promise<void> {
    if (this.closed || this.moving || this.busy.size || this.service.getPath() !== path) return;
    const service = this.service;
    const generation = this.generation;
    const button = entry.dragHandle!;
    const document = entry.node.ownerDocument;
    const hadFocus = document.activeElement === button;
    this.moving = true;
    const preview = group.filter(item => item.id !== task.id).map(item => item.id);
    const anchorIndex = preview.indexOf(anchor.id);
    preview.splice(anchorIndex + (direction === 'down' ? 1 : 0), 0, task.id);
    this.movePreview = preview;
    for (const item of group) this.busy.add(item.id);
    this.render();
    try {
      await service.moveTask(task, anchor, direction, group);
      if (!this.closed && generation === this.generation && service.getPath() === path) {
        const query = this.search.value.trim().toLocaleLowerCase();
        const visible = sortActiveTasks(service.getSnapshot().tasks.filter(item => item.urgent === task.urgent && item.important === task.important &&
          (!query || `${item.title}\n${item.note}`.toLocaleLowerCase().includes(query))));
        const position = visible.findIndex(item => item.id === task.id);
        if (position >= 0) setText(this.announcement, this.i18n.t('reorderAnnouncement', { title: task.title, position: position + 1, count: visible.length }));
      }
    } catch (reason) {
      new Notice(this.i18n.error(reason, 'reorderFailed'));
    } finally {
      if (!this.closed && generation === this.generation) {
        for (const item of group) this.busy.delete(item.id);
        this.moving = false;
        this.movePreview = null;
        this.render();
        const active = document.activeElement;
        if (hadFocus && service.getPath() === path && this.list.contains(entry.node) &&
            (active === document.body || active === button || entry.node.contains(active))) {
          const target = entry.dragHandle && !entry.dragHandle.disabled ? entry.dragHandle : entry.title;
          target.focus({ preventScroll: true });
        }
      }
    }
  }

  private async toggleTask(task: Task, check: HTMLInputElement): Promise<void> {
    if (this.busy.has(task.id) || this.archiveRemoving) return;
    const service = this.service;
    const generation = this.generation;
    const taskPath = service.getPath();
    const undoInList = this.targetUndo(this.binding?.file, taskPath, service);
    this.busy.add(task.id);
    check.disabled = true;
    this.clearArchiveButton.disabled = true;
    const row = this.rows.get(task.id);
    if (row) {
      row.title.disabled = true;
      row.body.classList.add('is-disabled');
      if (row.deleteButton) row.deleteButton.disabled = true;
    }
    try {
      if (task.completedAt !== null) await service.restore(task);
      else {
        const completed = await service.complete(task);
        const message = createFragment(fragment => fragment.append(`${this.i18n.t('taskCompleted')} `));
        const undo = el('button', 'zadachi-undo', this.i18n.t('undo'));
        undo.type = 'button';
        undo.addEventListener('click', () => {
          undo.disabled = true;
          void undoInList(target => target.restore(completed)).then(() => notice.hide()).catch((reason: unknown) => {
            undo.disabled = false;
            this.showError(reason);
          });
        });
        message.appendChild(undo);
        const notice = new Notice(message, 7000);
      }
    } catch (reason) {
      if (generation === this.generation) check.checked = task.completedAt !== null;
      this.showError(reason);
    } finally {
      if (!this.closed && generation === this.generation) {
        this.busy.delete(task.id);
        this.render();
      }
    }
  }

  private openArchiveDialog(mode: 'single' | 'all', task?: Task): void {
    const service = this.service;
    const generation = this.generation;
    const snapshot = service.getSnapshot();
    if (this.tab !== 'archive' || this.archiveDialog || this.archiveRemoving || this.moving || this.busy.size || snapshot.loading || snapshot.error) return;
    const tasks = mode === 'all'
      ? snapshot.tasks.filter(item => item.completedAt !== null)
      : task && task.completedAt !== null ? [task] : [];
    if (!tasks.length) return;
    const undoInList = this.targetUndo(this.binding?.file, service.getPath(), service);
    const dialog = new ArchiveConfirmModal(
      this.app, service, this.i18n, mode, tasks,
      removal => this.showArchiveUndo(removal, undoInList),
      busy => { if (generation === this.generation && !this.closed) { this.archiveRemoving = busy; this.render(); } },
      () => { if (this.archiveDialog === dialog) this.archiveDialog = null; },
    );
    this.archiveDialog = dialog;
    dialog.open();
  }

  private targetUndo(file: TFile | undefined, path: string, service: TaskService): (action: (target: TaskService) => Promise<unknown>) => Promise<void> {
    // A notice may outlive its tab. Reacquire the original file for the action.
    const files = file && this.files;
    if (file && files) return async action => {
      if (file.path !== path) throw new LocalizedError('pathChangedSettings');
      const { service: target, release } = files.acquire(file);
      try {
        if (target.getPath() !== path) throw new LocalizedError('pathChangedSettings');
        await action(target);
      } finally { release(); }
    };
    return async action => {
      if (service.getPath() !== path) throw new LocalizedError('pathChangedSettings');
      await action(service);
    };
  }

  private showArchiveUndo(removal: ArchiveRemoval, undoInList: (action: (service: TaskService) => Promise<unknown>) => Promise<void>): void {
    const message = createFragment(fragment => fragment.append(`${this.i18n.t('archiveRemoved', { count: removal.tasks.length })} `));
    const undo = el('button', 'zadachi-undo', this.i18n.t('undo'));
    undo.type = 'button';
    undo.addEventListener('click', () => {
      undo.disabled = true;
      void undoInList(service => service.undoArchiveRemoval(removal)).then(() => notice.hide()).catch((reason: unknown) => {
        undo.disabled = false;
        this.showError(reason);
      });
    });
    message.appendChild(undo);
    const notice = new Notice(message, 7000);
  }

  private empty(message: string): HTMLElement {
    this.emptyNode ??= el('div', 'zadachi-empty');
    setText(this.emptyNode, message);
    return this.emptyNode;
  }

  private showError(reason: unknown): void {
    new Notice(this.i18n.error(reason, 'saveTaskFailed'));
  }
}
