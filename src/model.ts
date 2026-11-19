import type { Task, TaskDraft } from './types';
import { LocalizedError } from './i18n';

const HEADER_1 = '# Задачи\n<!-- zadachi:version=1 -->\n';
const HEADER_2 = '# Задачи\n<!-- zadachi:version=2 -->\n';
const START = '<!-- zadachi:task -->';
const END = '<!-- zadachi:end -->';
const punctuation = /[\\`*_{}[\]()#+\-.!|]/g;
const escapedPunctuation = /\\([\\`*_{}[\]()#+\-.!|])/g;

function escapeTitle(title: string): string {
  return title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(punctuation, '\\$&');
}

function unescapeTitle(title: string): string {
  return title.replace(escapedPunctuation, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function validDate(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function validId(id: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
}

export function validateDraft(draft: TaskDraft): TaskDraft {
  const title = draft.title.trim();
  if (!title) throw new LocalizedError('titleRequired');
  if (/[\r\n]/.test(title)) throw new LocalizedError('titleSingleLine');
  if (typeof draft.note !== 'string' || /\r/.test(draft.note)) {
    throw new LocalizedError('unsupportedNote');
  }
  return { title, note: draft.note, urgent: !!draft.urgent, important: !!draft.important };
}

export function validateTask(task: Task): void {
  const draft = validateDraft(task);
  if (draft.title !== task.title || !validId(task.id) || !validDate(task.createdAt) ||
      (task.completedAt !== null && !validDate(task.completedAt)) ||
      typeof task.urgent !== 'boolean' || typeof task.important !== 'boolean' ||
      (task.order !== undefined && (!Number.isSafeInteger(task.order) || task.order < 0))) {
    throw new LocalizedError('invalidTask');
  }
}

export function serializeTasks(tasks: readonly Task[]): string {
  const seen = new Set<string>();
  const sections = tasks.map(task => {
    validateTask(task);
    if (seen.has(task.id)) throw new LocalizedError('duplicateId');
    seen.add(task.id);
    const lines = [START, `- [${task.completedAt ? 'x' : ' '}] ${escapeTitle(task.title)}`,
      `  - Идентификатор: ${task.id}`,
      `  - Создана: ${task.createdAt}`,
      `  - Срочно: ${task.urgent ? 'да' : 'нет'}`,
      `  - Важно: ${task.important ? 'да' : 'нет'}`,
      `  - Выполнена: ${task.completedAt ?? '—'}`];
    if (task.order !== undefined) lines.push(`  - Порядок: ${task.order}`);
    if (task.note !== '') lines.push(...task.note.split('\n').map(line => `  > ${line}`));
    lines.push(END);
    return lines.join('\n');
  });
  return (tasks.some(task => task.order !== undefined) ? HEADER_2 : HEADER_1) +
    (sections.length ? '\n' + sections.join('\n\n') + '\n' : '');
}

/** Recognize only plugin-owned documents, including damaged bodies which need an error view. */
export function isTaskDocument(raw: string): boolean {
  // The marker fits in this prefix, including both possible CRLF pairs.
  const text = raw.slice(0, Math.max(HEADER_1.length, HEADER_2.length) + 2).replace(/\r\n/g, '\n');
  return text.startsWith(HEADER_1) || text.startsWith(HEADER_2);
}

export function parseTasks(raw: string): Task[] {
  // Only the versioned format is accepted. Unrecognised text must never be discarded.
  const text = raw.replace(/\r\n/g, '\n');
  const version = text.startsWith(HEADER_1) ? 1 : text.startsWith(HEADER_2) ? 2 : 0;
  if (!version) throw new LocalizedError('unknownFormat');
  const rest = text.slice((version === 1 ? HEADER_1 : HEADER_2).length);
  if (!rest) return [];
  if (!rest.startsWith('\n') || !rest.endsWith('\n')) throw new LocalizedError('invalidStructure');
  const body = rest.slice(1, -1);
  const lines = body.split('\n');
  const tasks: Task[] = [];
  const seen = new Set<string>();
  let i = 0;
  const value = (line: string | undefined, prefix: string): string => {
    if (!line?.startsWith(prefix)) throw new LocalizedError('invalidStructure');
    return line.slice(prefix.length);
  };
  try {
    while (i < lines.length) {
      if (lines[i++] !== START) throw new LocalizedError('invalidStructure');
      const match = /^- \[([ x])\] (.*)$/.exec(lines[i++] ?? '');
      if (!match) throw new LocalizedError('invalidStructure');
      const id = value(lines[i++], '  - Идентификатор: ');
      const createdAt = value(lines[i++], '  - Создана: ');
      const urgent = value(lines[i++], '  - Срочно: ');
      const important = value(lines[i++], '  - Важно: ');
      const completed = value(lines[i++], '  - Выполнена: ');
      if (!['да', 'нет'].includes(urgent) || !['да', 'нет'].includes(important)) throw new LocalizedError('invalidPriority');
      let order: number | undefined;
      if (version === 2 && lines[i]?.startsWith('  - Порядок: ')) {
        const rawOrder = value(lines[i++], '  - Порядок: ');
        if (!/^(0|[1-9]\d*)$/.test(rawOrder)) throw new LocalizedError('invalidTask');
        order = Number(rawOrder);
        if (!Number.isSafeInteger(order)) throw new LocalizedError('invalidTask');
      }
      const note: string[] = [];
      while (i < lines.length && lines[i] !== END) {
        note.push(value(lines[i++], '  > '));
      }
      if (lines[i++] !== END) throw new LocalizedError('invalidStructure');
      const task: Task = { id, title: unescapeTitle(match[2]), createdAt, urgent: urgent === 'да',
        important: important === 'да', completedAt: completed === '—' ? null : completed, note: note.join('\n') };
      if (order !== undefined) task.order = order;
      if ((match[1] === 'x') !== (task.completedAt !== null)) throw new LocalizedError('inconsistentStatus');
      validateTask(task);
      if (seen.has(id)) throw new LocalizedError('duplicateId');
      seen.add(id);
      tasks.push(task);
      if (i < lines.length && lines[i++] !== '') throw new LocalizedError('invalidStructure');
    }
    return tasks;
  } catch (error) {
    throw new LocalizedError('readFailed', {}, error);
  }
}

export function sortActiveTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter(task => !task.completedAt).sort((a, b) =>
    (a.order === undefined ? (b.order === undefined ? 0 : 1) :
      (b.order === undefined ? -1 : a.order - b.order)) ||
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function sortArchivedTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter(task => task.completedAt).sort((a, b) =>
    b.completedAt!.localeCompare(a.completedAt!) || a.id.localeCompare(b.id));
}

export interface TaskGroup { key: string; title: string; tasks: Task[] }

export function groupTasks(tasks: readonly Task[]): TaskGroup[] {
  const groups: TaskGroup[] = [
    { key: 'first', title: 'В первую очередь', tasks: [] },
    { key: 'urgent', title: 'Срочное', tasks: [] },
    { key: 'important', title: 'Важное, без спешки', tasks: [] },
    { key: 'later', title: 'Когда будет время', tasks: [] },
  ];
  for (const task of sortActiveTasks(tasks)) {
    groups[task.urgent ? (task.important ? 0 : 1) : (task.important ? 2 : 3)].tasks.push(task);
  }
  return groups.filter(group => group.tasks.length > 0);
}

export function searchTasks(tasks: readonly Task[], query: string): Task[] {
  const value = query.trim().toLocaleLowerCase();
  return value ? tasks.filter(task => `${task.title}\n${task.note}`.toLocaleLowerCase().includes(value)) : [...tasks];
}
