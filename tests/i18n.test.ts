import { describe, expect, it, vi } from 'vitest';
import { en, I18n, LocalizedError, resolveLanguage, ru } from '../src/i18n';

describe('Локализация', () => {
  it('содержит одинаковые ключи и параметры в словарях', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
      const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      expect(placeholders(en[key]), key).toEqual(placeholders(ru[key]));
    }
  });

  it.each([
    ['ru', 'ru'], ['ru-RU', 'ru'], ['ru_RU', 'ru'],
    ['en', 'en'], ['en-GB', 'en'], ['fr', 'en'], ['zh-CN', 'en'], ['', 'en'],
  ] as const)('автоматически выбирает язык приложения %s → %s', (appLanguage, expected) => {
    expect(resolveLanguage('auto', appLanguage)).toBe(expected);
  });

  it('явный выбор имеет приоритет над языком приложения', () => {
    expect(resolveLanguage('ru', 'en-GB')).toBe('ru');
    expect(resolveLanguage('en', 'ru-RU')).toBe('en');
    const i18n = new I18n('auto', () => 'ru_RU');
    expect(i18n.t('archive')).toBe('Архив');
    const listener = vi.fn();
    const unsubscribe = i18n.subscribe(listener);
    i18n.setPreference('en');
    expect(i18n.t('archive')).toBe('Archive');
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    i18n.setPreference('ru');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('форматирует дату в выбранной локали', () => {
    const value = '2026-11-16T12:00:00.000Z';
    for (const [language, locale] of [['ru', 'ru-RU'], ['en', 'en-US']] as const) {
      const i18n = new I18n(language);
      const expected = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
      expect(i18n.locale).toBe(locale);
      expect(i18n.formatDate(value)).toBe(expected);
    }
  });

  it('не обрабатывает фигурные скобки повторно внутри названия пользователя', () => {
    const i18n = new I18n('en');
    expect(i18n.t('editTaskLabel', { title: 'Task {title}: {message}' }))
      .toBe('Edit task: Task {title}: {message}');
  });

  it('переводит вложенные ошибки при смене языка', () => {
    const error = new LocalizedError('saveFailed', {}, new LocalizedError('fileMissing', { path: 'Задачи.md' }));
    const i18n = new I18n('ru');
    expect(i18n.error(error)).toBe('Не удалось сохранить задачи: Файл «Задачи.md» не найден. Восстановите файл или измените путь в настройках.');
    i18n.setPreference('en');
    expect(i18n.error(error)).toBe('Could not save tasks: The file “Задачи.md” was not found. Restore it or change the path in settings.');
    expect(i18n.error(new Error('Storage failure'))).toBe('Storage failure');
  });
});
