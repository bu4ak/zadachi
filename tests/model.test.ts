import { describe, expect, it } from 'vitest';
import { groupTasks, isTaskDocument, parseTasks, searchTasks, serializeTasks, sortArchivedTasks } from '../src/model';
import { I18n } from '../src/i18n';
import type { Task } from '../src/types';

function task(index: number, extra: Partial<Task> = {}): Task {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: `Задача ${index}`, note: '', urgent: false, important: false,
    createdAt: '2026-11-16T10:00:00.000Z', completedAt: null, ...extra,
  };
}

describe('Markdown задач', () => {
  it('распознаёт собственный документ, но не пример внутри обычной заметки', () => {
    const own = serializeTasks([task(1)]);
    expect(isTaskDocument(own)).toBe(true);
    expect(isTaskDocument(own.replace(/\n/g, '\r\n'))).toBe(true);
    expect(isTaskDocument('# Задачи\nОбычный список заметок\n')).toBe(false);
    expect(isTaskDocument('Пример:\n```md\n' + own + '```')).toBe(false);
    expect(isTaskDocument(serializeTasks([]) + 'повреждённое тело')).toBe(true);
  });
  it('сохраняет многострочную заметку, ссылки и специальные символы названия', () => {
    const tasks = [task(1, {
      title: '<!-- zadachi:end --> & [[ссылка]] \\ *текст*',
      note: 'Первая строка\n[[Заметка|ссылка]]\n<!-- zadachi:end -->\n  > вложенная цитата\n',
      urgent: true, important: true,
    }), task(2, { completedAt: '2026-11-16T11:00:00.000Z' })];
    const markdown = serializeTasks(tasks);
    expect(markdown).toContain('[[Заметка|ссылка]]');
    expect(markdown).toContain('Срочно: да');
    expect(parseTasks(markdown)).toEqual(tasks);
  });

  it('читает ручное изменение видимых данных', () => {
    const markdown = serializeTasks([task(1, { note: 'Старая заметка' })])
      .replace('Задача 1', 'Новая задача')
      .replace('Старая заметка', 'Новая заметка')
      .replace('Срочно: нет', 'Срочно: да');
    expect(parseTasks(markdown)[0]).toMatchObject({ title: 'Новая задача', note: 'Новая заметка', urgent: true });
  });

  it('отклоняет неизвестное содержимое, дубликаты и несогласованный статус', () => {
    const markdown = serializeTasks([task(1)]);
    expect(() => parseTasks('# Чужая заметка\n')).toThrow();
    expect(() => parseTasks(`${markdown}\nПосторонний текст\n`)).toThrow();
    expect(() => serializeTasks([task(1), task(1)])).toThrow();
    expect(() => parseTasks(markdown.replace('- [ ]', '- [x]'))).toThrow();
    expect(() => parseTasks(markdown.replace('zadachi:version=1', 'zadachi:version=3'))).toThrow();
  });

  it('переводит вложенную ошибку чтения без изменения формата файла', () => {
    const original = task(1, { note: '[[Заметка]]', important: true });
    const markdown = serializeTasks([original]);
    expect(markdown).toContain('  - Важно: да');
    expect(parseTasks(markdown)).toEqual([original]);
    let caught: unknown;
    try { parseTasks(markdown.replace('Срочно: нет', 'Срочно: unknown')); } catch (error) { caught = error; }
    expect(new I18n('en').error(caught)).toBe('Could not read the task file: Invalid task priority.');
    expect(new I18n('ru').error(caught)).toBe('Не удалось прочитать файл задач: Некорректный приоритет задачи.');
  });

  it('сохраняет старый формат и читает новый порядок без потери полей', () => {
    const original = task(1, { note: '[[Заметка]]\nТекст', important: true });
    const legacy = serializeTasks([original]);
    expect(legacy).toContain('zadachi:version=1');
    expect(serializeTasks(parseTasks(legacy))).toBe(legacy);
    const ranked = [original, task(2, { order: 0 }), task(3, { order: 12, completedAt: '2026-11-16T11:00:00.000Z' })];
    const markdown = serializeTasks(ranked);
    expect(markdown).toContain('zadachi:version=2');
    expect(markdown).toContain('  - Порядок: 0');
    expect(parseTasks(markdown)).toEqual(ranked);
  });

  it('отклоняет отрицательный, дробный, небезопасный порядок и неизвестную версию', () => {
    const markdown = serializeTasks([task(1, { order: 1 })]);
    for (const order of ['-1', '1.5', '9007199254740992', 'NaN']) {
      expect(() => parseTasks(markdown.replace('Порядок: 1', `Порядок: ${order}`))).toThrow();
    }
    expect(() => parseTasks(markdown.replace('version=2', 'version=3'))).toThrow();
    expect(() => parseTasks(markdown.replace('version=2', 'version=1'))).toThrow();
    expect(() => serializeTasks([task(1, { order: -1 })])).toThrow();
  });
});

describe('Порядок и поиск', () => {
  it('показывает четыре непустые группы в порядке приоритетов', () => {
    const groups = groupTasks([task(4), task(3, { important: true }), task(2, { urgent: true }),
      task(1, { urgent: true, important: true })]);
    expect(groups.map(group => group.title)).toEqual(['В первую очередь', 'Срочное', 'Важное, без спешки', 'Когда будет время']);
    expect(groups.map(group => group.tasks[0].title)).toEqual(['Задача 1', 'Задача 2', 'Задача 3', 'Задача 4']);
    expect(groupTasks([task(2)]).map(group => group.title)).toEqual(['Когда будет время']);
  });

  it('сохраняет устойчивый порядок и ищет по заголовку и заметке', () => {
    const tasks = [task(2, { note: 'Встреча с коллегой' }), task(1), task(3, { createdAt: '2026-11-16T09:00:00.000Z' })];
    expect(groupTasks(tasks)[0].tasks.map(item => item.id)).toEqual([tasks[2].id, tasks[1].id, tasks[0].id]);
    expect(searchTasks(tasks, 'КОЛЛЕГОЙ')).toEqual([tasks[0]]);
    expect(searchTasks(tasks, 'ЗАДАЧА 1')).toEqual([tasks[1]]);
  });

  it('сортирует архив от новых завершений к старым', () => {
    const tasks = [task(1, { completedAt: '2026-11-15T10:00:00.000Z' }), task(2),
      task(3, { completedAt: '2026-11-16T10:00:00.000Z' })];
    expect(sortArchivedTasks(tasks).map(item => item.id)).toEqual([tasks[2].id, tasks[0].id]);
  });

  it('применяет ручной порядок независимо во всех группах', () => {
    const tasks: Task[] = [];
    for (let group = 0; group < 4; group++) {
      const priority = { urgent: group < 2, important: group % 2 === 0 };
      tasks.push(task(group * 3 + 1, priority));
      tasks.push(task(group * 3 + 2, { ...priority, order: 1 }));
      tasks.push(task(group * 3 + 3, { ...priority, order: 0 }));
    }
    expect(groupTasks(tasks).map(group => group.tasks.map(item => item.id))).toEqual(
      [0, 1, 2, 3].map(index => [tasks[index * 3 + 2].id, tasks[index * 3 + 1].id, tasks[index * 3].id]));
  });
});
