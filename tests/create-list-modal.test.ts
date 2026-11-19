// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateListModal } from '../src/create-list-modal';
import { I18n } from '../src/i18n';
import { installObsidianDom } from './obsidian-mock';

beforeEach(() => {
  document.body.replaceChildren();
  installObsidianDom();
});

function open(create: (path: string) => Promise<void>, language: 'ru' | 'en' = 'ru') {
  const modal = new CreateListModal({} as any, new I18n(language), 'Задачи.md', create);
  modal.open();
  const form = modal.contentEl.querySelector<HTMLFormElement>('form')!;
  const path = form.querySelector<HTMLInputElement>('input')!;
  const save = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const cancel = form.querySelector<HTMLButtonElement>('button[type="button"]')!;
  const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return { modal, form, path, save, cancel, submit };
}

describe('Создание списка задач', () => {
  it('предлагает путь по умолчанию и открывается на английском', async () => {
    const create = vi.fn(async (_path: string) => {});
    const { modal, path, save, submit } = open(create, 'en');
    expect(path.value).toBe('Задачи.md');
    expect(document.activeElement).toBe(path);
    expect(modal.titleEl.textContent).toBe('Create task list');
    expect(save.textContent).toBe('Create');
    submit();
    await vi.waitFor(() => expect(document.body.contains(modal.modalEl)).toBe(false));
    expect(create).toHaveBeenCalledExactlyOnceWith('Задачи.md');
  });

  it('добавляет расширение к введённому пути и сохраняет существующее расширение', async () => {
    const create = vi.fn(async (_path: string) => {});
    const first = open(create);
    first.path.value = '  Проекты/Работа  ';
    first.submit();
    await vi.waitFor(() => expect(document.body.contains(first.modal.modalEl)).toBe(false));
    expect(create).toHaveBeenNthCalledWith(1, 'Проекты/Работа.md');
    const second = open(create);
    second.path.value = 'Проекты/Другое.MD';
    second.submit();
    await vi.waitFor(() => expect(document.body.contains(second.modal.modalEl)).toBe(false));
    expect(create).toHaveBeenNthCalledWith(2, 'Проекты/Другое.MD');
  });

  it('блокирует повторную отправку и сохраняет путь после ошибки', async () => {
    let rejectFirst!: (error: Error) => void;
    const firstAttempt = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const create = vi.fn<(path: string) => Promise<void>>()
      .mockReturnValueOnce(firstAttempt)
      .mockResolvedValueOnce(undefined);
    const { modal, path, cancel, save, submit } = open(create, 'en');
    path.value = 'Folder/Draft';
    submit();
    expect([path.disabled, cancel.disabled, save.disabled]).toEqual([true, true, true]);
    submit();
    expect(create).toHaveBeenCalledTimes(1);
    rejectFirst(new Error('Storage unavailable'));
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect([path.disabled, cancel.disabled]).toEqual([false, false]);
    expect(path.value).toBe('Folder/Draft');
    expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain('Storage unavailable');
    expect(document.body.contains(modal.modalEl)).toBe(true);
    submit();
    await vi.waitFor(() => expect(document.body.contains(modal.modalEl)).toBe(false));
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith('Folder/Draft.md');
  });

  it('закрывает форму без создания при отмене', () => {
    const create = vi.fn(async (_path: string) => {});
    const { modal, path, cancel } = open(create);
    path.value = 'Черновик';
    cancel.click();
    expect(create).not.toHaveBeenCalled();
    expect(document.body.contains(modal.modalEl)).toBe(false);
  });

  it('передаёт путь с выходом из хранилища на проверку без записи', async () => {
    const written: string[] = [];
    const create = vi.fn(async (path: string) => {
      if (path.split('/').includes('..')) throw new Error('Invalid path');
      written.push(path);
    });
    const { modal, path, submit, save } = open(create, 'en');
    path.value = '../outside';
    submit();
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(create).toHaveBeenCalledExactlyOnceWith('../outside.md');
    expect(written).toEqual([]);
    expect(path.value).toBe('../outside');
    expect(modal.contentEl.querySelector('[role="alert"]')?.textContent).toContain('Invalid path');
    expect(document.body.contains(modal.modalEl)).toBe(true);
  });
});
