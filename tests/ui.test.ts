// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveRemoval, Task, TaskDraft, TaskService, TaskSnapshot } from '../src/types';
import { installObsidianDom, Notice } from './obsidian-mock';

import { TaskEditModal } from '../src/edit-modal';
import { I18n, LocalizedError } from '../src/i18n';
import { TaskView } from '../src/view';

const task = (overrides: Partial<Task> = {}): Task => ({
  id: '0b5fdd6d-2608-4e17-8b28-eb043187e923',
  title: 'Позвонить',
  note: 'Детали в [[Проект]]',
  urgent: false,
  important: false,
  createdAt: '2026-11-16T08:00:00.000Z',
  completedAt: null,
  ...overrides,
});

class FakeService implements TaskService {
  snapshot: TaskSnapshot = { tasks: [], loading: false, error: null };
  path = 'Задачи.md';
  listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  getPath = () => this.path;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  emit(tasks: readonly Task[]): void {
    this.snapshot = { ...this.snapshot, tasks };
    this.listeners.forEach(listener => listener());
  }
  load = vi.fn(async () => {});
  add = vi.fn(async (draft: TaskDraft) => {
    const created = task(draft);
    this.emit([...this.snapshot.tasks, created]);
    return created;
  });
  update = vi.fn(async (original: Task, draft: TaskDraft) => {
    const updated = { ...original, ...draft };
    this.emit(this.snapshot.tasks.map(item => item.id === original.id ? updated : item));
    return updated;
  });
  complete = vi.fn(async (original: Task) => {
    const completed = { ...original, completedAt: '2026-11-16T09:00:00.000Z' };
    this.emit(this.snapshot.tasks.map(item => item.id === original.id ? completed : item));
    return completed;
  });
  restore = vi.fn(async (original: Task) => {
    const restored = { ...original, completedAt: null };
    this.emit(this.snapshot.tasks.map(item => item.id === original.id ? restored : item));
    return restored;
  });
  deleteArchived = vi.fn(async (original: Task): Promise<ArchiveRemoval> => {
    this.emit(this.snapshot.tasks.filter(item => item.id !== original.id));
    return { tasks: [original], storagePath: this.path };
  });
  clearArchive = vi.fn(async (originals: readonly Task[]): Promise<ArchiveRemoval> => {
    this.emit(this.snapshot.tasks.filter(item => item.completedAt === null));
    return { tasks: originals, storagePath: this.path };
  });
  undoArchiveRemoval = vi.fn(async (removal: ArchiveRemoval) => {
    this.emit([...this.snapshot.tasks, ...removal.tasks]);
  });
  moveTask = vi.fn(async (original: Task, anchor: Task, direction: 'up' | 'down', group: readonly Task[]) => {
    const arranged = [...group].filter(item => item.id !== original.id);
    const index = arranged.findIndex(item => item.id === anchor.id);
    arranged.splice(index + (direction === 'down' ? 1 : 0), 0, original);
    const order = new Map(arranged.map((item, position) => [item.id, position]));
    this.emit(this.snapshot.tasks.map(item => order.has(item.id) ? { ...item, order: order.get(item.id)! } : item));
  });
}

function clickText(root: ParentNode, text: string): void {
  const button = [...root.querySelectorAll('button')].find(el => el.textContent?.trim() === text);
  if (!button) throw new Error(`Кнопка «${text}» не найдена`);
  button.click();
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function moveKey(handle: HTMLButtonElement, direction: 'up' | 'down'): void {
  handle.dispatchEvent(new KeyboardEvent('keydown', { key: direction === 'up' ? 'ArrowUp' : 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
}

function pointer(target: EventTarget, type: string, x: number, y: number, extra: { pointerId?: number; button?: number; primary?: boolean } = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: extra.button ?? 0 });
  Object.defineProperties(event, {
    pointerId: { value: extra.pointerId ?? 1 },
    isPrimary: { value: extra.primary ?? true },
  });
  target.dispatchEvent(event);
}

function rect(node: Element, top: number, bottom: number): void {
  node.getBoundingClientRect = () => ({ x: 0, y: top, top, bottom, left: 0, right: 300, width: 300, height: bottom - top, toJSON: () => ({}) });
}

function flowRects(rows: readonly HTMLElement[], groupTop: number): void {
  for (const row of rows) {
    row.getBoundingClientRect = () => {
      let top = groupTop;
      if (row.classList.contains('is-dragging')) top = parseFloat(row.style.top);
      else {
        for (const child of Array.from(row.parentElement!.children)) {
          if (child === row) break;
          const item = child as HTMLElement;
          if (item.classList.contains('zadachi-drag-placeholder')) top += parseFloat(item.style.height);
          else if (item.classList.contains('zadachi-row') && !item.classList.contains('is-dragging')) top += 40;
        }
      }
      return { x: 0, y: top, top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40, toJSON: () => ({}) };
    };
  }
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  document.body.replaceChildren();
  Notice.instances.length = 0;
  installObsidianDom();
});
afterEach(() => vi.restoreAllMocks());

describe('Редактирование задачи', () => {
  it('закрывает форму без сохранения изменений', () => {
    const service = new FakeService();
    const modal = new TaskEditModal({ workspace: {} } as any, service, task());
    modal.open();
    modal.contentEl.querySelector<HTMLInputElement>('[aria-label="Название задачи"]')!.value = 'Изменено';
    clickText(modal.contentEl, 'Отмена');
    expect(service.update).not.toHaveBeenCalled();
    expect(document.body.contains(modal.modalEl)).toBe(false);
  });

  it('сохраняет введённые данные и оба признака приоритета', async () => {
    const service = new FakeService();
    const original = task();
    const modal = new TaskEditModal({ workspace: {} } as any, service, original);
    modal.open();
    const title = modal.contentEl.querySelector<HTMLInputElement>('[aria-label="Название задачи"]')!;
    const note = modal.contentEl.querySelector<HTMLTextAreaElement>('[aria-label="Заметка"]')!;
    title.value = '  Новое название  ';
    note.value = 'Новые подробности';
    modal.contentEl.querySelector<HTMLButtonElement>('.zadachi-flag-urgent')!.click();
    modal.contentEl.querySelector<HTMLButtonElement>('.zadachi-flag-important')!.click();
    submit(modal.contentEl.querySelector('form')!);
    await flush();
    expect(service.update).toHaveBeenCalledOnce();
    expect(service.update).toHaveBeenCalledWith(original, {
      title: 'Новое название', note: 'Новые подробности', urgent: true, important: true,
    });
    expect(document.body.contains(modal.modalEl)).toBe(false);
  });

  it('сохраняет черновик и показывает ошибку при отказе записи', async () => {
    const service = new FakeService();
    service.update.mockRejectedValueOnce(new Error('Файл изменён'));
    const modal = new TaskEditModal({ workspace: {} } as any, service, task());
    modal.open();
    const title = modal.contentEl.querySelector<HTMLInputElement>('[aria-label="Название задачи"]')!;
    title.value = 'Несохранённый текст';
    submit(modal.contentEl.querySelector('form')!);
    await flush();
    expect(title.value).toBe('Несохранённый текст');
    expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain('Файл изменён');
    expect(document.body.contains(modal.modalEl)).toBe(true);
  });

  it('сохраняет приоритеты при переводе и отказе записи, затем повторно сохраняет черновик', async () => {
    const service = new FakeService();
    const locale = new I18n('ru');
    const original = task({ urgent: true, important: false });
    let reject!: (error: Error) => void;
    service.update.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const modal = new TaskEditModal({ workspace: {} } as any, service, original, locale);
    modal.open();
    const title = modal.contentEl.querySelector<HTMLInputElement>('.zadachi-edit-title')!;
    const note = modal.contentEl.querySelector<HTMLTextAreaElement>('.zadachi-edit-note')!;
    const urgent = modal.contentEl.querySelector<HTMLButtonElement>('.zadachi-flag-urgent')!;
    const important = modal.contentEl.querySelector<HTMLButtonElement>('.zadachi-flag-important')!;
    const form = modal.contentEl.querySelector<HTMLFormElement>('form')!;
    expect(urgent.getAttribute('aria-pressed')).toBe('true');
    expect(important.getAttribute('aria-pressed')).toBe('false');
    expect(urgent.querySelector<HTMLElement>('.zadachi-flag-icon')?.dataset.icon).toBe('zap');
    expect(important.querySelector<HTMLElement>('.zadachi-flag-icon')?.dataset.icon).toBe('star');
    expect(urgent.querySelector('.zadachi-flag-icon')?.getAttribute('aria-hidden')).toBe('true');
    title.value = 'Черновик';
    note.value = 'Новые детали';
    urgent.click();
    important.click();
    expect(urgent.getAttribute('aria-pressed')).toBe('false');
    expect(important.getAttribute('aria-pressed')).toBe('true');
    locale.setPreference('en');
    expect(urgent.textContent).toContain('Urgent');
    expect(important.textContent).toContain('Important');
    expect(urgent.getAttribute('aria-pressed')).toBe('false');
    expect(important.getAttribute('aria-pressed')).toBe('true');
    submit(form);
    expect(urgent.disabled).toBe(true);
    expect(important.disabled).toBe(true);
    submit(form);
    expect(service.update).toHaveBeenCalledOnce();
    reject(new Error('Write failed'));
    await flush(); await flush();
    expect(urgent.disabled).toBe(false);
    expect(important.disabled).toBe(false);
    expect(urgent.getAttribute('aria-pressed')).toBe('false');
    expect(important.getAttribute('aria-pressed')).toBe('true');
    expect(title.value).toBe('Черновик');
    expect(note.value).toBe('Новые детали');
    expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain('Write failed');
    submit(form);
    await flush();
    expect(service.update).toHaveBeenLastCalledWith(original, {
      title: 'Черновик', note: 'Новые детали', urgent: false, important: true,
    });
    expect(document.body.contains(modal.modalEl)).toBe(false);
  });

  it('открывает ссылку на заметку через workspace по явному нажатию', () => {
    const openLinkText = vi.fn();
    const service = new FakeService();
    const modal = new TaskEditModal({ workspace: { openLinkText } } as any, service, task());
    modal.open();
    expect(openLinkText).not.toHaveBeenCalled();
    modal.contentEl.querySelector<HTMLAnchorElement>('.zadachi-note-link')!.click();
    expect(openLinkText).toHaveBeenCalledWith('Проект', 'Задачи.md', false);
  });

  it('не сохраняет открытый черновик в другой файл после смены пути', async () => {
    const service = new FakeService();
    const modal = new TaskEditModal({ workspace: {} } as any, service, task());
    modal.open();
    const title = modal.contentEl.querySelector<HTMLInputElement>('[aria-label="Название задачи"]')!;
    title.value = 'Черновик';
    service.path = 'Другие.md';
    submit(modal.contentEl.querySelector('form')!);
    await flush();
    expect(service.update).not.toHaveBeenCalled();
    expect(title.value).toBe('Черновик');
    expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain('Файл задач изменился');
  });
});

async function openView(service: FakeService, i18n?: I18n): Promise<TaskView> {
  const view = new TaskView({ app: { workspace: { openLinkText: vi.fn() } } } as any, service, i18n);
  document.body.append(view.containerEl);
  await view.onOpen();
  return view;
}

describe('Панель задач', () => {
  it('оставляет свайпы Obsidian вне доступной ручки перетаскивания', async () => {
    const service = new FakeService();
    service.emit([
      task({ id: 'a' }),
      task({ id: 'b' }),
      task({ id: 'c', urgent: true }),
    ]);
    const view = await openView(service);
    const reachedHost = vi.fn();
    view.containerEl.addEventListener('touchstart', reachedHost);
    const touch = () => new Event('touchstart', { bubbles: true, cancelable: true });
    const activeHandle = view.containerEl.querySelector<HTMLButtonElement>('[data-task-id="a"] .zadachi-drag-handle')!;
    const disabledHandle = view.containerEl.querySelector<HTMLButtonElement>('[data-task-id="c"] .zadachi-drag-handle')!;
    const title = view.containerEl.querySelector<HTMLButtonElement>('[data-task-id="a"] .zadachi-task-title')!;

    expect(activeHandle.disabled).toBe(false);
    expect(disabledHandle.disabled).toBe(true);
    expect(activeHandle.dispatchEvent(touch())).toBe(true);
    expect(reachedHost).not.toHaveBeenCalled();
    disabledHandle.dispatchEvent(touch());
    title.dispatchEvent(touch());
    expect(reachedHost).toHaveBeenCalledTimes(2);
    await view.onClose();
  });

  it('сохраняет визуальный порядок до ответа записи и возвращает прежний при ошибке', async () => {
    const service = new FakeService();
    const a = task({ id: 'a', title: 'Первая' });
    const b = task({ id: 'b', title: 'Вторая' });
    const c = task({ id: 'c', title: 'Третья' });
    service.emit([a, b, c]);
    let reject!: (reason: Error) => void;
    service.moveTask.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const view = await openView(service);
    const input = view.containerEl.querySelector<HTMLInputElement>('.zadachi-input')!;
    input.value = 'Черновик';
    const rows = ['a', 'b', 'c'].map(id => view.containerEl.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!);
    flowRects(rows, 0);
    const group = rows[0].parentElement!;
    rect(group, 0, 120);
    rect(view.containerEl.children[1], 0, 200);
    const handle = rows[2].querySelector<HTMLButtonElement>('.zadachi-drag-handle')!;
    handle.focus();
    pointer(handle, 'pointerdown', 250, 100);
    pointer(document, 'pointermove', 250, 10);
    pointer(document, 'pointerup', 250, 11);
    expect(service.moveTask).toHaveBeenCalledOnce();
    expect([...group.querySelectorAll('.zadachi-row')]).toEqual([rows[2], rows[0], rows[1]]);
    expect(group.querySelector('.zadachi-drag-placeholder, .is-dragging')).toBeNull();
    expect(service.snapshot.tasks).toEqual([a, b, c]);
    expect(input.value).toBe('Черновик');
    reject(new Error('Ошибка записи'));
    await flush(); await flush();
    expect([...group.querySelectorAll('.zadachi-row')]).toEqual(rows);
    expect(input.value).toBe('Черновик');
    expect(document.body.textContent).toContain('Ошибка записи');
    await view.onClose();
  });

  it('перетаскивает исходную строку с заполнителем и не пишет до отпускания', async () => {
    const service = new FakeService();
    const a = task({ id: 'a', title: 'Первая' });
    const b = task({ id: 'b', title: 'Вторая' });
    const c = task({ id: 'c', title: 'Третья' });
    service.emit([a, b, c]);
    const view = await openView(service);
    const rows = ['a', 'b', 'c'].map(id => view.containerEl.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!);
    flowRects(rows, 0);
    rect(rows[0].parentElement!, 0, 120);
    rect(view.containerEl.children[1], 0, 200);
    const handle = rows[2].querySelector<HTMLButtonElement>('.zadachi-drag-handle')!;
    const saveMove = service.moveTask.getMockImplementation()!;
    service.moveTask.mockImplementationOnce(async (...args) => {
      expect(view.containerEl.querySelector('.zadachi-drag-placeholder, .is-dragging')).toBeNull();
      expect(rows[2].style.position).toBe('');
      expect(rows[2].style.getPropertyValue('--zadachi-drag-offset')).toBe('');
      await saveMove(...args);
    });
    handle.focus();
    pointer(handle, 'pointerdown', 250, 100);
    pointer(document, 'pointermove', 250, 10);
    const placeholder = view.containerEl.querySelector<HTMLElement>('.zadachi-drag-placeholder')!;
    expect(placeholder).not.toBeNull();
    expect(placeholder.nextElementSibling).toBe(rows[0]);
    expect(placeholder.style.height).toBe('40px');
    expect(rows[2].classList.contains('is-dragging')).toBe(true);
    expect(rows[2].style.getPropertyValue('--zadachi-drag-offset')).toContain('-90px');
    expect(document.querySelector('.zadachi-drag-ghost')).toBeNull();
    expect(handle.hasAttribute('aria-label')).toBe(false);
    expect(handle.hasAttribute('title')).toBe(false);
    expect(service.moveTask).not.toHaveBeenCalled();
    expect([...rows[0].parentElement!.querySelectorAll('.zadachi-row')]).toEqual(rows);
    pointer(document, 'pointerup', 250, 10);
    await flush(); await flush();
    expect(service.moveTask).toHaveBeenCalledWith(c, a, 'up', [a, b, c]);
    expect([...rows[0].parentElement!.children]).toEqual([rows[2], rows[0], rows[1]]);
    expect(document.querySelector('.zadachi-drag-ghost')).toBeNull();
    expect(view.containerEl.querySelector('.is-dragging, .zadachi-drag-placeholder')).toBeNull();
    expect(rows[2].style.position).toBe('');
    expect(rows[2].style.getPropertyValue('--zadachi-drag-offset')).toBe('');
    expect(document.activeElement).toBe(handle);
    expect(view.containerEl.querySelector('[role="status"].zadachi-sr-only')?.textContent).toContain('позиция 1 из 3');
    await view.onClose();
  });

  it('отменяет жест вне группы, по Escape, pointercancel и при обновлении данных', async () => {
    const service = new FakeService();
    const a = task({ id: 'a', title: 'Первая' });
    const b = task({ id: 'b', title: 'Вторая' });
    service.emit([a, b]);
    const view = await openView(service);
    const rows = ['a', 'b'].map(id => view.containerEl.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!);
    rows.forEach((row, index) => rect(row, index * 40, (index + 1) * 40));
    rect(rows[0].parentElement!, 0, 80);
    rect(view.containerEl.children[1], 0, 200);
    const handle = rows[1].querySelector<HTMLButtonElement>('.zadachi-drag-handle')!;
    const begin = () => { pointer(handle, 'pointerdown', 250, 60); pointer(document, 'pointermove', 250, 10); };
    const expectClean = () => {
      expect(view.containerEl.querySelector('.zadachi-drag-placeholder, .is-dragging')).toBeNull();
      expect(rows[1].style.position).toBe('');
      expect(rows[1].style.getPropertyValue('--zadachi-drag-offset')).toBe('');
    };
    begin();
    pointer(document, 'pointerup', 250, 160);
    expect(service.moveTask).not.toHaveBeenCalled();
    expectClean();
    begin();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    pointer(document, 'pointerup', 250, 10);
    expect(service.moveTask).not.toHaveBeenCalled();
    expectClean();
    begin();
    pointer(document, 'pointercancel', 250, 10);
    pointer(document, 'pointerup', 250, 10);
    expect(service.moveTask).not.toHaveBeenCalled();
    expectClean();
    begin();
    service.emit([{ ...a }, { ...b }]);
    pointer(document, 'pointerup', 250, 10);
    expect(service.moveTask).not.toHaveBeenCalled();
    expect(document.querySelector('.zadachi-drag-ghost')).toBeNull();
    expectClean();
    await view.onClose();
  });

  it('не переносит задачу в другую группу или на прежнее место и поддерживает перенос вниз', async () => {
    const service = new FakeService();
    const a = task({ id: 'a', title: 'Одна' });
    const b = task({ id: 'b', title: 'Другая' });
    const urgent = task({ id: 'c', title: 'Срочная', urgent: true });
    service.emit([a, b, urgent]);
    const view = await openView(service);
    const rowA = view.containerEl.querySelector<HTMLElement>('[data-task-id="a"]')!;
    const rowB = view.containerEl.querySelector<HTMLElement>('[data-task-id="b"]')!;
    const urgentRow = view.containerEl.querySelector<HTMLElement>('[data-task-id="c"]')!;
    rect(urgentRow, 0, 40);
    rect(rowA, 60, 100);
    rect(rowB, 100, 140);
    rect(rowA.parentElement!, 60, 140);
    rect(view.containerEl.children[1], 0, 200);
    expect(urgentRow.querySelector<HTMLButtonElement>('.zadachi-drag-handle')!.disabled).toBe(true);
    const handle = rowA.querySelector<HTMLButtonElement>('.zadachi-drag-handle')!;
    pointer(handle, 'pointerdown', 250, 80);
    pointer(document, 'pointermove', 250, 20);
    pointer(document, 'pointerup', 250, 20);
    expect(service.moveTask).not.toHaveBeenCalled();
    pointer(handle, 'pointerdown', 250, 80);
    pointer(document, 'pointermove', 250, 90);
    expect(view.containerEl.querySelector('.zadachi-drag-placeholder')?.nextElementSibling).toBe(rowA);
    pointer(document, 'pointerup', 250, 90);
    expect(service.moveTask).not.toHaveBeenCalled();
    pointer(handle, 'pointerdown', 250, 80);
    pointer(document, 'pointermove', 250, 135);
    const placeholder = view.containerEl.querySelector<HTMLElement>('.zadachi-drag-placeholder')!;
    expect(placeholder.previousElementSibling).toBe(rowB);
    expect(rowA.classList.contains('is-dragging')).toBe(true);
    pointer(document, 'pointerup', 250, 135);
    await flush(); await flush();
    expect(service.moveTask).toHaveBeenCalledWith(a, b, 'down', [a, b]);
    await view.onClose();
  });

  it('отменяет жест при смене поиска, вкладки, языка и закрытии', async () => {
    const service = new FakeService();
    const locale = new I18n('ru');
    service.emit([task({ id: 'a' }), task({ id: 'b' })]);
    const view = await openView(service, locale);
    rect(view.containerEl.children[1], 0, 200);
    const begin = () => {
      const rows = ['a', 'b'].map(id => view.containerEl.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!);
      rows.forEach((row, index) => rect(row, index * 40, (index + 1) * 40));
      rect(rows[0].parentElement!, 0, 80);
      const handle = rows[1].querySelector<HTMLButtonElement>('.zadachi-drag-handle')!;
      pointer(handle, 'pointerdown', 250, 60);
      pointer(document, 'pointermove', 250, 10);
      expect(view.containerEl.querySelector('.zadachi-drag-placeholder')).not.toBeNull();
      expect(rows[1].classList.contains('is-dragging')).toBe(true);
      expect(document.querySelector('.zadachi-drag-ghost')).toBeNull();
      return rows[1];
    };
    begin();
    view.containerEl.querySelector<HTMLInputElement>('.zadachi-search-input')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.containerEl.querySelector('.zadachi-drag-placeholder, .is-dragging')).toBeNull();
    begin();
    locale.setPreference('en');
    expect(view.containerEl.querySelector('.zadachi-drag-placeholder, .is-dragging')).toBeNull();
    begin();
    view.selectTab('archive');
    expect(view.containerEl.querySelector('.zadachi-drag-placeholder, .is-dragging')).toBeNull();
    view.selectTab('active');
    const moving = begin();
    await view.onClose();
    expect(moving.classList.contains('is-dragging')).toBe(false);
    expect(moving.style.position).toBe('');
    expect(moving.style.getPropertyValue('--zadachi-drag-offset')).toBe('');
    pointer(document, 'pointerup', 250, 10);
    expect(service.moveTask).not.toHaveBeenCalled();
  });

  it('не начинает жест вне ручки или до порога и очищает захват указателя', async () => {
    const service = new FakeService();
    service.emit([task({ id: 'a' }), task({ id: 'b' })]);
    const view = await openView(service);
    const rows = ['a', 'b'].map(id => view.containerEl.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!);
    rows.forEach((row, index) => rect(row, index * 40, (index + 1) * 40));
    rect(rows[0].parentElement!, 0, 80);
    rect(view.containerEl.children[1], 0, 200);
    const handle = rows[1].querySelector<HTMLButtonElement>('.zadachi-drag-handle')!;
    pointer(rows[1], 'pointerdown', 250, 60);
    pointer(document, 'pointermove', 250, 10);
    pointer(document, 'pointerup', 250, 10);
    pointer(handle, 'pointerdown', 250, 60);
    pointer(document, 'pointermove', 250, 56);
    expect(view.containerEl.querySelector('.zadachi-drag-placeholder, .is-dragging')).toBeNull();
    pointer(document, 'pointerup', 250, 56);
    pointer(handle, 'pointerdown', 250, 60, { button: 2 });
    pointer(document, 'pointermove', 250, 10);
    pointer(document, 'pointerup', 250, 10);
    pointer(handle, 'pointerdown', 250, 60);
    pointer(document, 'pointermove', 250, 10);
    expect(view.containerEl.querySelector('.zadachi-drag-placeholder')).not.toBeNull();
    expect(rows[1].classList.contains('is-dragging')).toBe(true);
    expect(document.querySelector('.zadachi-drag-ghost')).toBeNull();
    pointer(handle, 'lostpointercapture', 250, 10);
    pointer(document, 'pointerup', 250, 10);
    expect(service.moveTask).not.toHaveBeenCalled();
    expect(document.querySelector('.zadachi-drag-ghost')).toBeNull();
    expect(view.containerEl.querySelector('.zadachi-drag-placeholder, .is-dragging')).toBeNull();
    expect(rows[1].style.position).toBe('');
    expect(rows[1].style.getPropertyValue('--zadachi-drag-offset')).toBe('');
    await view.onClose();
  });

  it('прокручивает панель у края и отменяет запланированный кадр при завершении', async () => {
    const service = new FakeService();
    service.emit([task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })]);
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const view = await openView(service);
    const rows = ['a', 'b', 'c'].map(id => view.containerEl.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!);
    rows.forEach((row, index) => rect(row, index * 40, (index + 1) * 40));
    rect(rows[0].parentElement!, 0, 120);
    const scroll = view.containerEl.children[1] as HTMLElement;
    rect(scroll, 0, 80);
    const handle = rows[0].querySelector<HTMLButtonElement>('.zadachi-drag-handle')!;
    pointer(handle, 'pointerdown', 250, 20);
    pointer(document, 'pointermove', 250, 79);
    expect(callbacks).toHaveLength(1);
    callbacks[0](0);
    expect(scroll.scrollTop).toBeGreaterThan(0);
    expect(callbacks.length).toBeGreaterThan(1);
    pointer(document, 'pointercancel', 250, 79);
    expect(cancel).toHaveBeenCalled();
    await view.onClose();
  });

  it('при сохранении порядка блокирует всю группу, но не другие группы', async () => {
    const service = new FakeService();
    const first = task({ id: 'a', title: 'Первая' });
    const second = task({ id: 'b', title: 'Вторая' });
    const third = task({ id: 'c', title: 'Третья' });
    const other = task({ id: 'd', title: 'Срочная', urgent: true });
    service.emit([first, second, third, other]);
    let finish!: () => void;
    service.moveTask.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = await openView(service);
    const firstRow = view.containerEl.querySelector<HTMLElement>('[data-task-id="a"]')!;
    moveKey(firstRow.querySelector<HTMLButtonElement>('.zadachi-drag-handle')!, 'down');
    const thirdRow = view.containerEl.querySelector<HTMLElement>('[data-task-id="c"]')!;
    const thirdTitle = thirdRow.querySelector<HTMLButtonElement>('.zadachi-task-title')!;
    const thirdCheck = thirdRow.querySelector<HTMLInputElement>('.zadachi-check')!;
    expect(thirdTitle.disabled).toBe(true);
    expect(thirdCheck.disabled).toBe(true);
    thirdTitle.click();
    thirdCheck.click();
    expect(document.querySelector('.zadachi-modal')).toBeNull();
    expect(service.complete).not.toHaveBeenCalled();
    const otherRow = view.containerEl.querySelector<HTMLElement>('[data-task-id="d"]')!;
    expect(otherRow.querySelector<HTMLButtonElement>('.zadachi-task-title')!.disabled).toBe(false);
    const otherCheck = otherRow.querySelector<HTMLInputElement>('.zadachi-check')!;
    expect(otherCheck.disabled).toBe(false);
    otherCheck.click();
    await flush();
    expect(service.complete).toHaveBeenCalledWith(other);
    finish();
    await flush(); await flush();
    expect(thirdTitle.disabled).toBe(false);
    expect(thirdCheck.disabled).toBe(false);
    await view.onClose();
  });

  it('перемещает задачу к соседу в группе и оставляет фокус на подходящей кнопке', async () => {
    const service = new FakeService();
    const a = task({ id: 'a', title: 'Первая' });
    const b = task({ id: 'b', title: 'Вторая' });
    const c = task({ id: 'c', title: 'Третья' });
    const outside = task({ id: 'd', title: 'Срочная', urgent: true });
    service.emit([a, b, c, outside]);
    const view = await openView(service);
    const rowA = view.containerEl.querySelector<HTMLElement>('[data-task-id="a"]')!;
    const rowB = view.containerEl.querySelector<HTMLElement>('[data-task-id="b"]')!;
    const rowC = view.containerEl.querySelector<HTMLElement>('[data-task-id="c"]')!;
    const up = rowB.querySelector<HTMLButtonElement>('.zadachi-drag-handle')!;
    up.focus();
    moveKey(up, 'up');
    await flush(); await flush();
    expect(service.moveTask).toHaveBeenCalledWith(b, a, 'up', [a, b, c]);
    expect(view.containerEl.querySelector('[data-task-id="b"]')).toBe(rowB);
    expect([...rowB.parentElement!.children]).toEqual([rowB, rowA, rowC]);
    expect(document.activeElement).toBe(up);
    moveKey(up, 'up');
    expect(service.moveTask).toHaveBeenCalledOnce();
    moveKey(rowA.querySelector<HTMLButtonElement>('.zadachi-drag-handle')!, 'down');
    await flush(); await flush();
    expect(service.moveTask.mock.calls[1][0].id).toBe('a');
    expect(service.moveTask.mock.calls[1][1].id).toBe('c');
    expect(service.moveTask.mock.calls[1][2]).toBe('down');
    expect(service.moveTask.mock.calls[1][3].map(item => item.id)).toEqual(['b', 'a', 'c']);
    expect([...rowB.parentElement!.children]).toEqual([rowB, rowC, rowA]);
    await view.onClose();
  });

  it('при поиске перемещает относительно видимого соседа и передаёт полную группу', async () => {
    const service = new FakeService();
    const a = task({ id: 'a', title: 'Показать первое' });
    const hidden = task({ id: 'b', title: 'Другая задача', note: '' });
    const c = task({ id: 'c', title: 'Показать второе' });
    service.emit([a, hidden, c]);
    const view = await openView(service);
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-search-toggle')!.click();
    const search = view.containerEl.querySelector<HTMLInputElement>('.zadachi-search-input')!;
    search.value = 'Показать';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const rowA = view.containerEl.querySelector<HTMLElement>('[data-task-id="a"]')!;
    const rowC = view.containerEl.querySelector<HTMLElement>('[data-task-id="c"]')!;
    moveKey(rowA.querySelector<HTMLButtonElement>('.zadachi-drag-handle')!, 'up');
    expect(service.moveTask).not.toHaveBeenCalled();
    moveKey(rowC.querySelector<HTMLButtonElement>('.zadachi-drag-handle')!, 'up');
    await flush(); await flush();
    expect(service.moveTask).toHaveBeenCalledWith(c, a, 'up', [a, hidden, c]);
    expect([...view.containerEl.querySelectorAll('.zadachi-row')].map(row => (row as HTMLElement).dataset.taskId)).toEqual(['c', 'a']);
    expect(search.value).toBe('Показать');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect([...view.containerEl.querySelectorAll('.zadachi-row')].map(row => (row as HTMLElement).dataset.taskId)).toEqual(['c', 'a', 'b']);
    await view.onClose();
  });

  it('блокирует повторное перемещение и сохраняет список и ввод при ошибке', async () => {
    const service = new FakeService();
    service.emit([task({ id: 'a', title: 'Первая' }), task({ id: 'b', title: 'Вторая' })]);
    let fail!: (reason: Error) => void;
    service.moveTask.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const view = await openView(service);
    const input = view.containerEl.querySelector<HTMLInputElement>('.zadachi-input')!;
    input.value = 'Черновик';
    const row = view.containerEl.querySelector<HTMLElement>('[data-task-id="b"]')!;
    const up = row.querySelector<HTMLButtonElement>('.zadachi-drag-handle')!;
    up.focus();
    moveKey(up, 'up');
    moveKey(up, 'up');
    expect(service.moveTask).toHaveBeenCalledOnce();
    expect(up.disabled).toBe(true);
    expect(row.querySelector<HTMLButtonElement>('.zadachi-task-title')!.disabled).toBe(true);
    expect(row.querySelector<HTMLInputElement>('.zadachi-check')!.disabled).toBe(true);
    expect([...view.containerEl.querySelectorAll('.zadachi-row')].map(node => (node as HTMLElement).dataset.taskId)).toEqual(['b', 'a']);
    fail(new Error('Ошибка записи'));
    await flush(); await flush();
    expect(view.containerEl.querySelector('[data-task-id="b"]')).toBe(row);
    expect([...view.containerEl.querySelectorAll('.zadachi-row')].map(node => (node as HTMLElement).dataset.taskId)).toEqual(['a', 'b']);
    expect(input.value).toBe('Черновик');
    expect(up.disabled).toBe(false);
    expect(document.activeElement).toBe(up);
    expect(document.body.textContent).toContain('Ошибка записи');
    await view.onClose();
  });

  it('локализует кнопки порядка и скрывает их в архиве', async () => {
    const service = new FakeService();
    const locale = new I18n('ru');
    service.emit([
      task({ id: 'a', title: 'Одна' }), task({ id: 'b', title: 'Другая' }),
      task({ id: 'c', title: 'Архивная', completedAt: '2026-11-16T09:00:00.000Z' }),
    ]);
    const view = await openView(service, locale);
    const up = view.containerEl.querySelector<HTMLButtonElement>('[data-task-id="b"] .zadachi-drag-handle')!;
    const label = document.getElementById(up.getAttribute('aria-labelledby')!)!;
    expect(label.textContent).toBe('Перетащить задачу: Другая');
    expect(up.hasAttribute('aria-label')).toBe(false);
    expect(up.hasAttribute('title')).toBe(false);
    expect(up.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown');
    locale.setPreference('en');
    expect(label.textContent).toBe('Drag to reorder task: Другая');
    expect(up.getAttribute('aria-description')).toContain('Alt + ↑/↓');
    const other = await openView(service, locale);
    const handles = [...document.querySelectorAll<HTMLButtonElement>('.zadachi-drag-handle')];
    const names = handles.map(handle => handle.getAttribute('aria-labelledby'));
    expect(new Set(names).size).toBe(handles.length);
    for (const handle of handles) {
      expect(handle.hasAttribute('aria-label')).toBe(false);
      expect(handle.hasAttribute('title')).toBe(false);
      expect(handle.querySelector(`#${handle.getAttribute('aria-labelledby')}`)).not.toBeNull();
    }
    await other.onClose();
    view.selectTab('archive');
    expect(view.containerEl.querySelector('.zadachi-drag-handle')).toBeNull();
    await view.onClose();
  });

  it('показывает удаление только в архиве и не удаляет при отмене', async () => {
    const service = new FakeService();
    service.emit([task({ id: 'active' }), task({ id: 'done', title: 'Готово', completedAt: '2026-11-16T09:00:00.000Z' })]);
    const view = await openView(service);
    expect(view.containerEl.querySelector<HTMLElement>('.zadachi-archive-actions')!.hidden).toBe(true);
    expect(view.containerEl.querySelector('.zadachi-delete-archived')).toBeNull();
    view.selectTab('archive');
    expect(view.containerEl.querySelector<HTMLElement>('.zadachi-archive-actions')!.hidden).toBe(false);
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-delete-archived')!.click();
    const modal = document.querySelector<HTMLElement>('.zadachi-confirm-modal')!;
    expect(modal.textContent).toContain('Готово');
    expect(modal.querySelectorAll('p')).toHaveLength(1);
    expect(modal.textContent).not.toContain('Markdown');
    expect(modal.textContent).not.toContain('копию');
    clickText(modal, 'Отмена');
    expect(service.deleteArchived).not.toHaveBeenCalled();
    expect(service.clearArchive).not.toHaveBeenCalled();
    expect(view.containerEl.querySelectorAll('.zadachi-row')).toHaveLength(1);
    await view.onClose();
  });

  it('удаляет выбранную задачу и возвращает её в архив по отмене', async () => {
    const service = new FakeService();
    const first = task({ id: 'a', title: 'Одна', note: 'Заметка [[Проект]]', urgent: true, important: true, createdAt: '2026-11-15T07:00:00.000Z', completedAt: '2026-11-16T09:00:00.000Z' });
    const second = task({ id: 'b', title: 'Другая', completedAt: '2026-11-16T10:00:00.000Z' });
    service.emit([first, second]);
    const view = await openView(service);
    view.selectTab('archive');
    const survivor = view.containerEl.querySelector('[data-task-id="b"]')!;
    view.containerEl.querySelector<HTMLButtonElement>('[data-task-id="a"] .zadachi-delete-archived')!.click();
    const modal = document.querySelector<HTMLElement>('.zadachi-confirm-modal')!;
    clickText(modal, 'Удалить задачу');
    await flush(); await flush();
    expect(service.deleteArchived).toHaveBeenCalledOnce();
    expect(service.deleteArchived).toHaveBeenCalledWith(first);
    expect(view.containerEl.querySelector('[data-task-id="b"]')).toBe(survivor);
    expect(view.containerEl.querySelector('[data-task-id="a"]')).toBeNull();
    expect(Notice.instances[0].noticeEl.textContent).toContain('Удалено задач из архива: 1');
    clickText(Notice.instances[0].noticeEl, 'Отменить');
    await flush(); await flush();
    expect(service.undoArchiveRemoval).toHaveBeenCalledOnce();
    expect(service.snapshot.tasks.find(item => item.id === first.id)).toEqual(first);
    expect(view.containerEl.querySelector('[data-task-id="a"]')).not.toBeNull();
    await view.onClose();
  });

  it('очищает все задачи архива независимо от поиска и сохраняет активные', async () => {
    const service = new FakeService();
    const active = task({ id: 'active', title: 'Активная' });
    const a = task({ id: 'a', title: 'Совпадение', note: 'Первое описание', urgent: true, completedAt: '2026-11-16T09:00:00.000Z' });
    const b = task({ id: 'b', title: 'Скрытая поиском', note: 'Второе описание', important: true, createdAt: '2026-11-14T08:00:00.000Z', completedAt: '2026-11-16T10:00:00.000Z' });
    service.emit([active, a, b]);
    const view = await openView(service);
    view.selectTab('archive');
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-search-toggle')!.click();
    const search = view.containerEl.querySelector<HTMLInputElement>('.zadachi-search-input')!;
    search.value = 'Совпадение';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.containerEl.querySelectorAll('.zadachi-row')).toHaveLength(1);
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-clear-archive')!.click();
    const modal = document.querySelector<HTMLElement>('.zadachi-confirm-modal')!;
    expect(modal.textContent).toContain('все выполненные задачи: 2');
    expect(modal.textContent).toContain('Поиск не ограничивает очистку');
    clickText(modal, 'Очистить весь архив');
    await flush(); await flush();
    expect(service.clearArchive).toHaveBeenCalledWith([a, b]);
    expect(service.snapshot.tasks).toEqual([active]);
    expect(view.containerEl.querySelector<HTMLButtonElement>('.zadachi-clear-archive')!.disabled).toBe(true);
    clickText(Notice.instances[0].noticeEl, 'Отменить');
    await flush(); await flush();
    expect(service.snapshot.tasks).toEqual([active, a, b]);
    await view.onClose();
  });

  it('оставляет подтверждение при ошибке и блокирует повторный запрос во время сохранения', async () => {
    const service = new FakeService();
    const original = task({ completedAt: '2026-11-16T09:00:00.000Z' });
    service.emit([original]);
    service.deleteArchived.mockRejectedValueOnce(new Error('Нет доступа'));
    const view = await openView(service);
    view.selectTab('archive');
    const row = view.containerEl.querySelector('.zadachi-row')!;
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-delete-archived')!.click();
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-delete-archived')!.click();
    expect(document.querySelectorAll('.zadachi-confirm-modal')).toHaveLength(1);
    const modal = document.querySelector<HTMLElement>('.zadachi-confirm-modal')!;
    const confirm = modal.querySelector<HTMLButtonElement>('.zadachi-confirm-delete')!;
    confirm.click();
    await flush(); await flush();
    expect(modal.querySelector('[role="alert"]')?.textContent).toContain('Нет доступа');
    expect(view.containerEl.querySelector('.zadachi-row')).toBe(row);
    let finish!: (value: ArchiveRemoval) => void;
    service.deleteArchived.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    confirm.click();
    confirm.click();
    await flush();
    expect(service.deleteArchived).toHaveBeenCalledTimes(2);
    expect(confirm.disabled).toBe(true);
    finish({ tasks: [original], storagePath: service.path });
    await flush(); await flush();
    expect(document.querySelector('.zadachi-confirm-modal')).toBeNull();
    await view.onClose();
  });

  it('локализует подтверждение и не удаляет при смене файла', async () => {
    const service = new FakeService();
    const locale = new I18n('ru');
    service.emit([task({ title: 'Task', completedAt: '2026-11-16T09:00:00.000Z' })]);
    const view = await openView(service, locale);
    view.selectTab('archive');
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-clear-archive')!.click();
    const modal = document.querySelector<HTMLElement>('.zadachi-confirm-modal')!;
    locale.setPreference('en');
    expect(modal.textContent).toContain('Clear the entire archive?');
    expect(modal.textContent).toContain('Search does not limit this action.');
    expect(modal.querySelectorAll('p')).toHaveLength(1);
    expect(modal.textContent).not.toContain('Markdown');
    expect(modal.textContent).not.toContain('backup');
    expect(view.containerEl.querySelector('.zadachi-clear-archive')?.textContent).toBe('Clear archive');
    service.path = 'Другие.md';
    clickText(modal, 'Clear entire archive');
    await flush();
    expect(service.clearArchive).not.toHaveBeenCalled();
    expect(modal.querySelector('[role="alert"]')?.textContent).toContain('The task file changed');
    clickText(modal, 'Cancel');
    await view.onClose();
  });

  it('не отменяет удаление в другом файле и не мешает повторить после возврата', async () => {
    const service = new FakeService();
    const completed = task({ completedAt: '2026-11-16T09:00:00.000Z' });
    service.emit([completed]);
    const view = await openView(service);
    view.selectTab('archive');
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-delete-archived')!.click();
    clickText(document.querySelector<HTMLElement>('.zadachi-confirm-modal')!, 'Удалить задачу');
    await flush(); await flush();
    service.path = 'Другие.md';
    clickText(Notice.instances[0].noticeEl, 'Отменить');
    await flush();
    expect(service.undoArchiveRemoval).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Файл задач изменился');
    service.path = 'Задачи.md';
    clickText(Notice.instances[0].noticeEl, 'Отменить');
    await flush(); await flush();
    expect(service.undoArchiveRemoval).toHaveBeenCalledOnce();
    expect(service.snapshot.tasks[0].completedAt).toBe(completed.completedAt);
    await view.onClose();
  });


  it('переключает язык без потери ввода, поиска, фокуса и элементов задач', async () => {
    const service = new FakeService();
    const locale = new I18n('ru');
    service.emit([task({ title: 'Alpha', urgent: true, important: true })]);
    const view = await openView(service, locale);
    const input = view.containerEl.querySelector<HTMLInputElement>('.zadachi-input')!;
    input.value = 'Черновик';
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-search-toggle')!.click();
    const search = view.containerEl.querySelector<HTMLInputElement>('.zadachi-search-input')!;
    search.value = 'Alpha';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.focus();
    const row = view.containerEl.querySelector('.zadachi-row')!;
    const group = view.containerEl.querySelector('.zadachi-group')!;
    locale.setPreference('en');
    expect(view.getDisplayText()).toBe('Zadachi');
    expect(input.value).toBe('Черновик');
    expect(input.placeholder).toBe('What needs to be done?');
    expect(search.value).toBe('Alpha');
    expect(search.getAttribute('aria-label')).toBe('Search titles and notes');
    expect(document.activeElement).toBe(search);
    expect(view.containerEl.querySelector('.zadachi-row')).toBe(row);
    expect(view.containerEl.querySelector('.zadachi-group')).toBe(group);
    expect(group.textContent).toContain('Do first');
    expect(row.querySelector('.zadachi-check')?.getAttribute('aria-label')).toBe('Complete task “Alpha”');
    expect([...view.containerEl.querySelectorAll('.zadachi-tab')].map(tab => tab.textContent)).toEqual(['Tasks1', 'Archive0']);
    await view.onClose();
  });

  it('показывает английский архив, дату, отмену и сообщения об ошибке', async () => {
    const service = new FakeService();
    const locale = new I18n('en');
    const completed = task({ id: 'a', title: 'Review', completedAt: '2026-11-16T09:00:00.000Z' });
    const active = task({ id: 'b', title: 'Prepare' });
    service.emit([completed, active]);
    const view = await openView(service, locale);
    view.selectTab('archive');
    const row = view.containerEl.querySelector('.zadachi-row')!;
    expect(row.querySelector('time')?.textContent).toBe(`Completed ${locale.formatDate(completed.completedAt!)}`);
    expect(row.querySelector('.zadachi-check')?.getAttribute('aria-label')).toBe('Restore task “Review”');
    view.selectTab('active');
    view.containerEl.querySelector<HTMLInputElement>('.zadachi-check')!.click();
    await flush();
    expect(Notice.instances[0].noticeEl.textContent).toContain('Task completed.');
    expect(Notice.instances[0].noticeEl.textContent).toContain('Undo');
    service.snapshot = { ...service.snapshot, error: 'Ошибка чтения', errorCause: new LocalizedError('fileMissing', { path: 'list.md' }) };
    service.listeners.forEach(listener => listener());
    expect(view.containerEl.querySelector('.zadachi-status')?.textContent).toContain('The file “list.md” was not found.');
    expect(view.containerEl.querySelector('.zadachi-retry')?.textContent).toBe('Retry');
    locale.setPreference('ru');
    expect(view.containerEl.querySelector('.zadachi-status')?.textContent).toContain('Файл «list.md» не найден.');
    await view.onClose();
  });

  it('локализует пустой поиск и окно, сохраняя редактируемые поля', async () => {
    const service = new FakeService();
    const locale = new I18n('en');
    service.emit([task({ title: 'One' })]);
    const view = await openView(service, locale);
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-search-toggle')!.click();
    const search = view.containerEl.querySelector<HTMLInputElement>('.zadachi-search-input')!;
    search.value = 'missing';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.containerEl.querySelector('.zadachi-empty')?.textContent).toBe('No matching tasks.');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-task-title')!.click();
    const modal = document.querySelector<HTMLElement>('.zadachi-modal')!;
    const title = modal.querySelector<HTMLInputElement>('.zadachi-edit-title')!;
    const note = modal.querySelector<HTMLTextAreaElement>('.zadachi-edit-note')!;
    title.value = 'Draft title';
    note.value = 'Draft note';
    note.focus();
    expect(modal.textContent).toContain('Edit task');
    expect(modal.textContent).toContain('Save');
    locale.setPreference('ru');
    expect(modal.textContent).toContain('Редактировать задачу');
    expect(modal.textContent).toContain('Сохранить');
    expect(title.value).toBe('Draft title');
    expect(note.value).toBe('Draft note');
    expect(document.activeElement).toBe(note);
    clickText(modal, 'Отмена');
    await view.onClose();
  });

  it('при выполнении удаляет только нужную строку и сохраняет остальные строки и группы', async () => {
    const service = new FakeService();
    const first = task({ id: 'a', title: 'Первая', note: '' });
    const second = task({ id: 'b', title: 'Вторая', note: '' });
    const urgent = task({ id: 'c', title: 'Срочная', urgent: true, note: '' });
    service.emit([first, second, urgent]);
    const view = await openView(service);
    const group = view.containerEl.querySelector('.zadachi-group-later')!;
    const urgentGroup = view.containerEl.querySelector('.zadachi-group-urgent')!;
    const rows = [...group.querySelectorAll('.zadachi-row')];
    const urgentRow = urgentGroup.querySelector('.zadachi-row');
    const observed: MutationRecord[] = [];
    const observer = new MutationObserver(records => observed.push(...records));
    observer.observe(group.querySelector('.zadachi-items')!, { childList: true });
    rows[0].querySelector<HTMLInputElement>('.zadachi-check')!.click();
    await flush();
    const records = [...observed, ...observer.takeRecords()];
    expect(view.containerEl.querySelector('.zadachi-group-later')).toBe(group);
    expect(view.containerEl.querySelector('.zadachi-group-urgent')).toBe(urgentGroup);
    expect(group.querySelector('.zadachi-row')).toBe(rows[1]);
    expect(urgentGroup.querySelector('.zadachi-row')).toBe(urgentRow);
    expect(records.flatMap(record => [...record.addedNodes])).toEqual([]);
    expect(records.flatMap(record => [...record.removedNodes])).toEqual([rows[0]]);
    observer.disconnect();
    await view.onClose();
  });

  it('не перестраивает список при повторной публикации тех же данных', async () => {
    const service = new FakeService();
    const original = task({ note: '' });
    service.emit([original]);
    const view = await openView(service);
    const list = view.containerEl.querySelector('.zadachi-list')!;
    const title = list.querySelector<HTMLButtonElement>('.zadachi-task-title')!;
    title.focus();
    const observed: MutationRecord[] = [];
    const observer = new MutationObserver(records => observed.push(...records));
    observer.observe(list, { childList: true, subtree: true });
    service.emit([{ ...original }]);
    await flush();
    expect([...observed, ...observer.takeRecords()]).toEqual([]);
    expect(list.querySelector('.zadachi-task-title')).toBe(title);
    expect(document.activeElement).toBe(title);
    observer.disconnect();
    await view.onClose();
  });

  it('обновляет изменённую задачу и использует актуальные данные при нажатии', async () => {
    const service = new FakeService();
    const original = task({ id: 'a', title: 'Старое', note: '' });
    service.emit([original, task({ id: 'b', title: 'Соседняя', urgent: true, note: '' })]);
    const view = await openView(service);
    const oldRow = [...view.containerEl.querySelectorAll('.zadachi-row')].find(row => row.textContent?.includes('Старое'))!;
    const updated = { ...original, title: 'Новое', note: 'Обновлено', urgent: true };
    service.emit([updated, service.snapshot.tasks[1]]);
    const urgentGroup = view.containerEl.querySelector('.zadachi-group-urgent')!;
    expect(urgentGroup.contains(oldRow)).toBe(true);
    expect(oldRow.querySelector('.zadachi-task-title')?.textContent).toBe('Новое');
    expect(oldRow.querySelector('.zadachi-task-note')?.textContent).toBe('Обновлено');
    const check = oldRow.querySelector<HTMLInputElement>('.zadachi-check')!;
    expect(check.getAttribute('aria-label')).toContain('Новое');
    check.click();
    await flush();
    expect(service.complete).toHaveBeenCalledWith(updated);
    view.selectTab('archive');
    const archived = view.containerEl.querySelector('.zadachi-row');
    expect(archived).not.toBe(oldRow);
    expect(archived?.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-16T09:00:00.000Z');
    archived!.querySelector<HTMLInputElement>('.zadachi-check')!.click();
    await flush();
    expect(service.restore).toHaveBeenCalledWith({ ...updated, completedAt: '2026-11-16T09:00:00.000Z' });
    await view.onClose();
  });

  it('переносит задачу до удаления опустевшей группы', async () => {
    const service = new FakeService();
    const original = task({ id: 'a', title: 'Переместить', note: '' });
    const other = task({ id: 'b', title: 'Уже срочная', urgent: true, note: '' });
    service.emit([original, other]);
    const view = await openView(service);
    const list = view.containerEl.querySelector('.zadachi-list')!;
    const oldGroup = list.querySelector('.zadachi-group-later')!;
    const oldItems = oldGroup.querySelector('.zadachi-items')!;
    const row = oldGroup.querySelector('.zadachi-row')!;
    const focused = row.querySelector<HTMLButtonElement>('.zadachi-task-title')!;
    focused.focus();
    const observer = new MutationObserver(() => {});
    observer.observe(list, { childList: true, subtree: true });
    service.emit([{ ...original, urgent: true }, other]);
    const records = observer.takeRecords();
    const rowRemoved = records.findIndex(record => record.target === oldItems && [...record.removedNodes].includes(row));
    const groupRemoved = records.findIndex(record => record.target === list && [...record.removedNodes].includes(oldGroup));
    expect(rowRemoved).toBeGreaterThanOrEqual(0);
    expect(groupRemoved).toBeGreaterThan(rowRemoved);
    expect(list.querySelector('.zadachi-group-urgent')?.contains(row)).toBe(true);
    expect(document.activeElement).toBe(focused);
    observer.disconnect();
    await view.onClose();
  });

  it('при изменении порядка не перемещает остальные строки и сохраняет фокус', async () => {
    const service = new FakeService();
    const first = task({ id: 'a', title: 'Первая', note: '' });
    const second = task({ id: 'b', title: 'Вторая', note: '' });
    const third = task({ id: 'c', title: 'Третья', note: '' });
    service.emit([first, second, third]);
    const view = await openView(service);
    const items = view.containerEl.querySelector('.zadachi-items')!;
    const [firstRow, secondRow, thirdRow] = [...items.querySelectorAll('.zadachi-row')];
    const focused = secondRow.querySelector<HTMLButtonElement>('.zadachi-task-title')!;
    focused.focus();
    const observer = new MutationObserver(() => {});
    observer.observe(items, { childList: true });
    service.emit([{ ...first, createdAt: '2026-11-16T09:00:00.000Z' }, second, third]);
    const records = observer.takeRecords();
    expect([...items.children]).toEqual([secondRow, thirdRow, firstRow]);
    expect(records.flatMap(record => [...record.removedNodes])).toEqual([firstRow]);
    expect(records.flatMap(record => [...record.addedNodes])).toEqual([firstRow]);
    expect(document.activeElement).toBe(focused);
    observer.disconnect();
    await view.onClose();
  });

  it('при ошибке сохраняет строку и возвращает флажок в прежнее состояние', async () => {
    const service = new FakeService();
    service.emit([task()]);
    service.complete.mockRejectedValueOnce(new Error('Нет доступа'));
    const view = await openView(service);
    const row = view.containerEl.querySelector('.zadachi-row')!;
    const check = row.querySelector<HTMLInputElement>('.zadachi-check')!;
    check.click();
    await flush();
    expect(view.containerEl.querySelector('.zadachi-row')).toBe(row);
    expect(row.querySelector('.zadachi-check')).toBe(check);
    expect(check.checked).toBe(false);
    expect(check.disabled).toBe(false);
    expect(document.body.textContent).toContain('Нет доступа');
    await view.onClose();
  });

  it('отправляет форму один раз и оставляет фокус в поле', async () => {
    const service = new FakeService();
    let finish!: (result: Task) => void;
    service.add.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = await openView(service);
    const input = view.containerEl.querySelector<HTMLInputElement>('[aria-label="Название новой задачи"]')!;
    input.value = '  Проверить отчёт  ';
    clickText(view.containerEl, 'Срочно');
    const form = view.containerEl.querySelector('form')!;
    submit(form);
    submit(form);
    expect(service.add).toHaveBeenCalledOnce();
    expect(service.add).toHaveBeenCalledWith({ title: 'Проверить отчёт', note: '', urgent: true, important: false });
    expect(input.value).toBe('  Проверить отчёт  ');
    finish(task({ title: 'Проверить отчёт', urgent: true }));
    await flush();
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(view.containerEl.querySelector('[aria-pressed="true"]')).toBeNull();
    await view.onClose();
  });

  it('сохраняет введённый текст и приоритет при ошибке добавления', async () => {
    const service = new FakeService();
    service.add.mockRejectedValueOnce(new Error('Нет доступа к файлу'));
    const view = await openView(service);
    const input = view.containerEl.querySelector<HTMLInputElement>('[aria-label="Название новой задачи"]')!;
    input.value = 'Новая задача';
    clickText(view.containerEl, 'Важно');
    submit(view.containerEl.querySelector('form')!);
    await flush();
    expect(input.value).toBe('Новая задача');
    expect(view.containerEl.querySelector('[aria-pressed="true"]')?.textContent).toContain('Важно');
    expect(document.body.textContent).toContain('Нет доступа к файлу');
    expect(document.activeElement).toBe(input);
    await view.onClose();
  });

  it('не отправляет задачу при выборе символа через IME', async () => {
    vi.useFakeTimers();
    try {
      const service = new FakeService();
      const view = await openView(service);
      const input = view.containerEl.querySelector<HTMLInputElement>('.zadachi-input')!;
      const form = view.containerEl.querySelector<HTMLFormElement>('form')!;
      input.value = '日本語';
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      submit(form);
      expect(service.add).not.toHaveBeenCalled();
      expect(input.value).toBe('日本語');
      vi.runAllTimers();
      submit(form);
      await flush();
      expect(service.add).toHaveBeenCalledOnce();
      await view.onClose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('показывает непустые группы и общие счётчики', async () => {
    const service = new FakeService();
    service.emit([
      task({ id: 'later', title: 'Позже', createdAt: '2026-11-16T08:04:00.000Z' }),
      task({ id: 'both', title: 'Сейчас', urgent: true, important: true }),
      task({ id: 'urgent', title: 'Срочная', urgent: true }),
      task({ id: 'important', title: 'Важная', important: true }),
      task({ id: 'archive', title: 'Готово', completedAt: '2026-11-16T09:00:00.000Z' }),
    ]);
    const view = await openView(service);
    const groups = [...view.containerEl.querySelectorAll('.zadachi-group-heading')].map(el => el.textContent?.trim());
    expect(groups).toEqual(['В первую очередь1', 'Срочное1', 'Важное, без спешки1', 'Когда будет время1']);
    expect([...view.containerEl.querySelectorAll('.zadachi-tab-count')].map(el => el.textContent)).toEqual(['4', '1']);
    expect([...view.containerEl.querySelectorAll('.zadachi-task-title')].map(el => el.textContent))
      .toEqual(['Сейчас', 'Срочная', 'Важная', 'Позже']);
    await view.onClose();
  });

  it('ищет по названию и заметке только в выбранной вкладке', async () => {
    const service = new FakeService();
    service.emit([
      task({ id: 'one', title: 'Созвон', note: 'Бюджет продукта' }),
      task({ id: 'two', title: 'Бюджет команды', note: '' }),
      task({ id: 'three', title: 'Отчёт', note: 'Бюджет', completedAt: '2026-11-16T09:00:00.000Z' }),
    ]);
    const view = await openView(service);
    view.containerEl.querySelector<HTMLButtonElement>('[aria-label="Открыть поиск"]')!.click();
    const search = view.containerEl.querySelector<HTMLInputElement>('[aria-label="Поиск по названию и заметке"]')!;
    search.value = 'БЮДЖЕТ';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect([...view.containerEl.querySelectorAll('.zadachi-task-title')].map(el => el.textContent))
      .toEqual(['Созвон', 'Бюджет команды']);
    expect([...view.containerEl.querySelectorAll('.zadachi-tab-count')].map(el => el.textContent)).toEqual(['2', '1']);
    view.selectTab('archive');
    expect([...view.containerEl.querySelectorAll('.zadachi-task-title')].map(el => el.textContent)).toEqual(['Отчёт']);
    expect(view.containerEl.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-16T09:00:00.000Z');
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(search.value).toBe('');
    expect(view.containerEl.querySelector('.zadachi-search')?.hasAttribute('hidden')).toBe(true);
    await view.onClose();
  });

  it('сохраняет доступность встроенного поиска после ввода и сбрасывает его по Escape', async () => {
    const service = new FakeService();
    service.emit([
      task({ id: 'a', title: 'Подготовить бюджет' }),
      task({ id: 'b', title: 'Проверить отчёт' }),
    ]);
    const view = await openView(service);
    const wrap = view.containerEl.querySelector<HTMLElement>('.zadachi-search')!;
    const toggle = view.containerEl.querySelector<HTMLButtonElement>('.zadachi-search-toggle')!;
    const search = view.containerEl.querySelector<HTMLInputElement>('.zadachi-search-input')!;
    expect(wrap.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    // In a wide container CSS displays the search without pressing the toggle.
    search.value = 'бюджет';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(wrap.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect([...view.containerEl.querySelectorAll('.zadachi-task-title')].map(el => el.textContent)).toEqual(['Подготовить бюджет']);

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(search.value).toBe('');
    expect(wrap.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(view.containerEl.querySelectorAll('.zadachi-task-title')).toHaveLength(2);
    await view.onClose();
  });

  it('выполняет задачу и восстанавливает её кнопкой уведомления', async () => {
    const service = new FakeService();
    const original = task();
    service.emit([original]);
    const view = await openView(service);
    view.containerEl.querySelector<HTMLInputElement>('.zadachi-check')!.click();
    await flush();
    expect(service.complete).toHaveBeenCalledWith(original);
    expect(view.containerEl.querySelector('.zadachi-task-title')).toBeNull();
    expect(Notice.instances).toHaveLength(1);
    clickText(Notice.instances[0].noticeEl, 'Отменить');
    await flush();
    expect(service.restore).toHaveBeenCalledWith({ ...original, completedAt: '2026-11-16T09:00:00.000Z' });
    expect(view.containerEl.querySelector('.zadachi-task-title')?.textContent).toBe(original.title);
    expect(document.body.contains(Notice.instances[0].noticeEl)).toBe(false);
    await view.onClose();
  });

  it('восстанавливает задачу из архива одним нажатием', async () => {
    const service = new FakeService();
    const completed = task({ completedAt: '2026-11-16T09:00:00.000Z' });
    service.emit([completed]);
    const view = await openView(service);
    view.selectTab('archive');
    view.containerEl.querySelector<HTMLInputElement>('.zadachi-check')!.click();
    await flush();
    expect(service.restore).toHaveBeenCalledWith(completed);
    expect(view.containerEl.querySelector('.zadachi-task-title')).toBeNull();
    view.selectTab('active');
    expect(view.containerEl.querySelector('.zadachi-task-title')?.textContent).toBe(completed.title);
    await view.onClose();
  });

  it('не восстанавливает задачу в другой файл после смены пути', async () => {
    const service = new FakeService();
    service.emit([task()]);
    const view = await openView(service);
    view.containerEl.querySelector<HTMLInputElement>('.zadachi-check')!.click();
    await flush();
    service.path = 'Другие.md';
    clickText(Notice.instances[0].noticeEl, 'Отменить');
    await flush();
    expect(service.restore).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Файл задач изменился');
    await view.onClose();
  });

  it('связывает вкладки с панелью и не повторяет идентификаторы окон', async () => {
    const service = new FakeService();
    const first = await openView(service);
    const second = await openView(service);
    const firstPanel = first.containerEl.querySelector<HTMLElement>('[role="tabpanel"]')!;
    const firstTabs = [...first.containerEl.querySelectorAll<HTMLElement>('[role="tab"]')];
    const secondPanel = second.containerEl.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(firstPanel.id).not.toBe(secondPanel.id);
    expect(firstTabs.map(tab => tab.getAttribute('aria-controls'))).toEqual([firstPanel.id, firstPanel.id]);
    expect(firstPanel.getAttribute('aria-labelledby')).toBe(firstTabs[0].id);
    first.selectTab('archive');
    expect(firstPanel.getAttribute('aria-labelledby')).toBe(firstTabs[1].id);
    expect(firstTabs.map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    await first.onClose();
    await second.onClose();
  });

  it('отписывается от обновлений при закрытии', async () => {
    const service = new FakeService();
    const view = await openView(service);
    expect(service.listeners.size).toBe(1);
    await view.onClose();
    expect(service.listeners.size).toBe(0);
    service.emit([task()]);
    expect(view.containerEl.querySelector('.zadachi-task-title')).toBeNull();
  });

  it('сворачивает только выбранную группу и сохраняет счётчики', async () => {
    const service = new FakeService();
    service.emit([
      task({ id: 'a', title: 'Срочное один', urgent: true }),
      task({ id: 'b', title: 'Срочное два', urgent: true }),
      task({ id: 'c', title: 'Обычное', urgent: false }),
    ]);
    const view = await openView(service);
    const urgent = view.containerEl.querySelector<HTMLElement>('.zadachi-group-urgent')!;
    const later = view.containerEl.querySelector<HTMLElement>('.zadachi-group-later')!;
    const toggle = urgent.querySelector<HTMLButtonElement>('.zadachi-group-toggle')!;
    const items = urgent.querySelector<HTMLElement>('.zadachi-items')!;
    expect(toggle.getAttribute('aria-controls')).toBe(items.id);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(items.hidden).toBe(false);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(items.hidden).toBe(true);
    expect(items.childElementCount).toBe(0);
    expect(urgent.querySelector('.zadachi-group-count')?.textContent).toBe('2');
    expect(later.querySelector<HTMLElement>('.zadachi-items')!.hidden).toBe(false);
    expect(view.containerEl.querySelector('.zadachi-tab-count')?.textContent).toBe('3');
    service.emit([...service.snapshot.tasks]);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(items.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(items.hidden).toBe(false);
    expect(items.childElementCount).toBe(2);
    expect(service.update).not.toHaveBeenCalled();
    expect(service.moveTask).not.toHaveBeenCalled();
    await view.onClose();
  });

  it('отменяет перетаскивание перед сворачиванием группы', async () => {
    const service = new FakeService();
    service.emit([task({ id: 'a', title: 'Первая' }), task({ id: 'b', title: 'Вторая' })]);
    const view = await openView(service);
    const rows = ['a', 'b'].map(id => view.containerEl.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!);
    flowRects(rows, 0);
    const items = rows[0].parentElement!;
    rect(items, 0, 80);
    rect(view.containerEl.children[1], 0, 200);
    const handle = rows[1].querySelector<HTMLButtonElement>('.zadachi-drag-handle')!;
    pointer(handle, 'pointerdown', 250, 60);
    pointer(document, 'pointermove', 250, 10);
    expect(items.querySelector('.zadachi-drag-placeholder')).not.toBeNull();
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.click();
    expect(items.querySelector('.zadachi-drag-placeholder, .is-dragging')).toBeNull();
    expect(rows[1].style.position).toBe('');
    expect(items.hidden).toBe(true);
    pointer(document, 'pointerup', 250, 10);
    expect(service.moveTask).not.toHaveBeenCalled();
    await view.onClose();
  });

  it('разворачивает совпадения при поиске и возвращает свёрнутое состояние после очистки', async () => {
    const service = new FakeService();
    service.emit([
      task({ id: 'a', title: 'Подготовить бюджет', urgent: true }),
      task({ id: 'b', title: 'Проверить отчёт', urgent: true }),
      task({ id: 'c', title: 'Другое дело' }),
    ]);
    const view = await openView(service);
    const urgent = () => view.containerEl.querySelector<HTMLElement>('.zadachi-group-urgent')!;
    urgent().querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.click();
    expect(urgent().querySelector<HTMLElement>('.zadachi-items')!.hidden).toBe(true);
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-search-toggle')!.click();
    const search = view.containerEl.querySelector<HTMLInputElement>('.zadachi-search-input')!;
    search.value = 'бюджет';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(urgent().querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(urgent().querySelector<HTMLElement>('.zadachi-items')!.hidden).toBe(false);
    expect(urgent().querySelector('.zadachi-task-title')?.textContent).toBe('Подготовить бюджет');
    expect(urgent().querySelector('.zadachi-group-count')?.textContent).toBe('1');
    urgent().querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.click();
    expect(urgent().querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.getAttribute('aria-expanded')).toBe('false');
    expect(urgent().querySelector<HTMLElement>('.zadachi-items')!.hidden).toBe(true);
    search.value = 'бюдже';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(urgent().querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(urgent().querySelector<HTMLElement>('.zadachi-items')!.hidden).toBe(false);
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(urgent().querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.getAttribute('aria-expanded')).toBe('false');
    expect(urgent().querySelector<HTMLElement>('.zadachi-items')!.hidden).toBe(true);
    expect(urgent().querySelector('.zadachi-group-count')?.textContent).toBe('2');
    await view.onClose();
  });

  it('начинает новое представление с развёрнутыми группами', async () => {
    const service = new FakeService();
    service.emit([task({ id: 'a', urgent: true })]);
    const first = await openView(service);
    first.containerEl.querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.click();
    expect(first.containerEl.querySelector<HTMLElement>('.zadachi-items')!.hidden).toBe(true);
    await first.onClose();
    const second = await openView(service);
    expect(second.containerEl.querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(second.containerEl.querySelector<HTMLElement>('.zadachi-items')!.hidden).toBe(false);
    expect(service.update).not.toHaveBeenCalled();
    expect(service.moveTask).not.toHaveBeenCalled();
    await second.onClose();
  });

  it('не меняет обычное состояние группы при сворачивании результатов поиска', async () => {
    const service = new FakeService();
    service.emit([task({ id: 'a', title: 'Согласовать бюджет', urgent: true })]);
    const view = await openView(service);
    view.containerEl.querySelector<HTMLButtonElement>('.zadachi-search-toggle')!.click();
    const search = view.containerEl.querySelector<HTMLInputElement>('.zadachi-search-input')!;
    const group = () => view.containerEl.querySelector<HTMLElement>('.zadachi-group-urgent')!;
    search.value = 'бюджет';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    group().querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.click();
    expect(group().querySelector<HTMLElement>('.zadachi-items')!.hidden).toBe(true);
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(group().querySelector<HTMLButtonElement>('.zadachi-group-toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(group().querySelector<HTMLElement>('.zadachi-items')!.hidden).toBe(false);
    await view.onClose();
  });

  it('переводит подпись добавления и сохраняет доступные признаки приоритета', async () => {
    const service = new FakeService();
    const locale = new I18n('ru');
    const view = await openView(service, locale);
    const add = view.containerEl.querySelector<HTMLButtonElement>('.zadachi-add')!;
    const urgent = view.containerEl.querySelector<HTMLButtonElement>('.zadachi-flag-urgent')!;
    const important = view.containerEl.querySelector<HTMLButtonElement>('.zadachi-flag-important')!;
    expect(add.querySelector('.zadachi-add-label')?.textContent).toBe('Добавить');
    expect(add.textContent).toContain('↵');
    urgent.click();
    expect(urgent.getAttribute('aria-pressed')).toBe('true');
    expect(important.getAttribute('aria-pressed')).toBe('false');
    locale.setPreference('en');
    expect(add.querySelector('.zadachi-add-label')?.textContent).toBe('Add');
    expect(add.getAttribute('aria-label')).toBe('Add task');
    expect(urgent.getAttribute('aria-pressed')).toBe('true');
    expect(important.getAttribute('aria-pressed')).toBe('false');
    await view.onClose();
  });
});
