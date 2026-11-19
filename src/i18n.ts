export type Language = 'ru' | 'en';
export type LanguagePreference = 'auto' | Language;
export type MessageParams = Record<string, string | number>;

export const ru = {
  pluginName: 'Zadachi',
  commandOpen: 'Открыть список',
  commandQuickAdd: 'Быстро добавить',
  commandArchive: 'Открыть архив',
  commandCreateList: 'Создать список задач',
  newListName: 'Новый список задач',
  listPathLabel: 'Путь и имя списка',
  listPathHint: 'Можно указать папки, например «Проекты/Ремонт.md».',
  createList: 'Создать',
  createListFailed: 'Не удалось создать список.',
  listExists: 'Файл «{path}» уже существует. Выберите другое имя.',
  openMarkdown: 'Открыть как Markdown',
  openAsTasks: 'Открыть как список задач',
  ribbonOpen: 'Zadachi: открыть список',
  composerPlaceholder: 'Что нужно сделать?',
  composerLabel: 'Название новой задачи',
  addTask: 'Добавить задачу',
  addShort: 'Добавить',
  urgent: 'Срочно',
  important: 'Важно',
  taskList: 'Список задач',
  active: 'Дела',
  archive: 'Архив',
  searchOpen: 'Открыть поиск',
  searchClose: 'Закрыть поиск',
  searchPlaceholder: 'Поиск по задачам',
  searchLabel: 'Поиск по названию и заметке',
  loading: 'Загрузка задач…',
  retry: 'Повторить',
  groupFirst: 'В первую очередь',
  groupUrgent: 'Срочное',
  groupImportant: 'Важное, без спешки',
  groupLater: 'Когда будет время',
  noResults: 'Ничего не найдено.',
  noActive: 'Нет активных задач.',
  noArchive: 'Архив пока пуст.',
  restoreTask: 'Вернуть задачу «{title}» в дела',
  completeTask: 'Выполнить задачу «{title}»',
  editTaskLabel: 'Редактировать задачу: {title}',
  completedOn: 'Выполнено {date}',
  taskCompleted: 'Задача выполнена.',
  undo: 'Отменить',
  editTitle: 'Редактировать задачу',
  title: 'Название',
  taskTitle: 'Название задачи',
  noteOptional: 'Заметка (необязательно)',
  note: 'Заметка',
  notePlaceholder: 'Подробности, ссылки или [[заметки]]',
  priority: 'Приоритет',
  noteLinks: 'Ссылки из заметки',
  cancel: 'Отмена',
  save: 'Сохранить',
  language: 'Язык интерфейса',
  languageDescription: 'Выберите язык плагина. Автоматический режим использует язык Obsidian.',
  languageAuto: 'Как в Obsidian',
  languageRussian: 'Русский',
  languageEnglish: 'English',
  storageFile: 'Список по умолчанию',
  storageDescription: 'Этот список открывается кнопкой плагина. Другие списки можно открывать из папок. По умолчанию: {path}.',
  apply: 'Применить',
  storageSelected: 'Файл хранения выбран.',
  storagePathLabel: 'Путь к файлу задач',
  openStorage: 'Открыть файл хранения',
  openStorageDescription: 'Задачи можно читать и править в Markdown. Сохраняйте служебные строки и структуру файла.',
  openFile: 'Открыть файл',
  fileUnavailable: 'Файл пока недоступен. Проверьте путь и сообщение в панели.',
  invalidSavedPath: 'Путь в настройках некорректен. Выберите файл хранения в настройках плагина.',
  unknownError: 'Неизвестная ошибка.',
  saveTaskFailed: 'Не удалось сохранить задачу.',
  pathChangedSettings: 'Файл задач изменился. Откройте нужный файл в настройках.',
  pathChangedEditor: 'Файл задач изменился. Откройте задачу заново.',
  titleRequired: 'Введите название задачи.',
  titleSingleLine: 'Название задачи должно быть одной строкой.',
  unsupportedNote: 'Заметка содержит неподдерживаемый символ.',
  invalidTask: 'Некорректные данные задачи.',
  duplicateId: 'Повторяется идентификатор задачи.',
  unknownFormat: 'Файл задач имеет неизвестный формат или повреждён.',
  invalidStructure: 'Нарушена структура файла задач.',
  invalidPriority: 'Некорректный приоритет задачи.',
  inconsistentStatus: 'Статус и дата выполнения не совпадают.',
  readFailed: 'Не удалось прочитать файл задач: {message}',
  invalidPath: 'Укажите путь к Markdown-файлу внутри хранилища, например «Задачи.md».',
  idFailed: 'Не удалось создать идентификатор задачи.',
  folderOccupied: 'Путь «{path}» занят файлом.',
  fileMissing: 'Файл «{path}» не найден. Восстановите файл или измените путь в настройках.',
  notFile: '«{path}» не является файлом.',
  pathChangedAction: 'Файл задач изменился. Повторите действие в текущем списке.',
  changeNotSaved: 'Изменение задачи не сохранено.',
  saveFailed: 'Не удалось сохранить задачи: {message}',
  taskConflict: 'Задача изменилась в файле. Обновите список и повторите действие.',
  alreadyCompleted: 'Задача уже выполнена.',
  alreadyActive: 'Задача уже находится в списке дел.',
  deleteArchivedTask: 'Удалить из архива задачу «{title}»',
  clearArchive: 'Очистить архив',
  deleteTaskTitle: 'Удалить задачу из архива?',
  deleteTaskDescription: 'Задача «{title}» будет удалена из архива.',
  clearArchiveTitle: 'Очистить весь архив?',
  clearArchiveDescription: 'Будут удалены все выполненные задачи: {count}. Поиск не ограничивает очистку.',
  deleteTaskConfirm: 'Удалить задачу',
  clearArchiveConfirm: 'Очистить весь архив',
  archiveRemoved: 'Удалено задач из архива: {count}.',
  archiveRemovalFailed: 'Не удалось удалить задачи из архива.',
  deleteActiveForbidden: 'Удалить можно только выполненную задачу из архива.',
  archiveChanged: 'Архив изменился. Проверьте обновлённый список и повторите очистку.',
  archiveEmpty: 'Архив уже пуст.',
  archiveUndoConflict: 'Некоторые удалённые задачи уже есть в файле. Отмена не применена.',
  reorderConflict: 'Порядок задач изменился. Проверьте список и повторите перемещение.',
  reorderInvalid: 'Перемещать можно только активные задачи внутри одной группы.',
  reorderFailed: 'Не удалось изменить порядок задач.',
  dragTask: 'Перетащить задачу: {title}',
  dragKeyboardHelp: 'Alt + ↑/↓ — переместить задачу с клавиатуры',
  reorderAnnouncement: 'Задача «{title}»: позиция {position} из {count}.',
} as const;

export type MessageKey = keyof typeof ru;

export const en: Record<MessageKey, string> = {
  pluginName: 'Zadachi',
  commandOpen: 'Open task list',
  commandQuickAdd: 'Quick add',
  commandArchive: 'Open archive',
  commandCreateList: 'Create task list',
  newListName: 'New task list',
  listPathLabel: 'List path and name',
  listPathHint: 'You can include folders, for example “Projects/Renovation.md”.',
  createList: 'Create',
  createListFailed: 'Could not create the list.',
  listExists: 'The file “{path}” already exists. Choose another name.',
  openMarkdown: 'Open as Markdown',
  openAsTasks: 'Open as task list',
  ribbonOpen: 'Zadachi: open task list',
  composerPlaceholder: 'What needs to be done?',
  composerLabel: 'New task title',
  addTask: 'Add task',
  addShort: 'Add',
  urgent: 'Urgent',
  important: 'Important',
  taskList: 'Task list',
  active: 'Tasks',
  archive: 'Archive',
  searchOpen: 'Open search',
  searchClose: 'Close search',
  searchPlaceholder: 'Search tasks',
  searchLabel: 'Search titles and notes',
  loading: 'Loading tasks…',
  retry: 'Retry',
  groupFirst: 'Do first',
  groupUrgent: 'Urgent',
  groupImportant: 'Important, no rush',
  groupLater: 'When there is time',
  noResults: 'No matching tasks.',
  noActive: 'No active tasks.',
  noArchive: 'The archive is empty.',
  restoreTask: 'Restore task “{title}”',
  completeTask: 'Complete task “{title}”',
  editTaskLabel: 'Edit task: {title}',
  completedOn: 'Completed {date}',
  taskCompleted: 'Task completed.',
  undo: 'Undo',
  editTitle: 'Edit task',
  title: 'Title',
  taskTitle: 'Task title',
  noteOptional: 'Note (optional)',
  note: 'Note',
  notePlaceholder: 'Details, links or [[notes]]',
  priority: 'Priority',
  noteLinks: 'Links in the note',
  cancel: 'Cancel',
  save: 'Save',
  language: 'Interface language',
  languageDescription: 'Choose the plugin language. Automatic mode follows the Obsidian language.',
  languageAuto: 'Same as Obsidian',
  languageRussian: 'Русский',
  languageEnglish: 'English',
  storageFile: 'Default task list',
  storageDescription: 'The plugin button opens this list. Open other lists from your folders. Default: {path}.',
  apply: 'Apply',
  storageSelected: 'Storage file selected.',
  storagePathLabel: 'Task file path',
  openStorage: 'Open storage file',
  openStorageDescription: 'Read and edit tasks in Markdown. Keep the metadata lines and file structure.',
  openFile: 'Open file',
  fileUnavailable: 'The file is unavailable. Check the path and the message in the task view.',
  invalidSavedPath: 'The saved path is invalid. Choose a storage file in the plugin settings.',
  unknownError: 'Unknown error.',
  saveTaskFailed: 'Could not save the task.',
  pathChangedSettings: 'The task file changed. Select the correct file in settings.',
  pathChangedEditor: 'The task file changed. Open the task again.',
  titleRequired: 'Enter a task title.',
  titleSingleLine: 'The task title must be a single line.',
  unsupportedNote: 'The note contains an unsupported character.',
  invalidTask: 'Invalid task data.',
  duplicateId: 'A task ID is duplicated.',
  unknownFormat: 'The task file has an unknown format or is damaged.',
  invalidStructure: 'The task file structure is invalid.',
  invalidPriority: 'Invalid task priority.',
  inconsistentStatus: 'The status and completion date do not match.',
  readFailed: 'Could not read the task file: {message}',
  invalidPath: 'Enter a Markdown file path inside the vault, for example “Задачи.md”.',
  idFailed: 'Could not create a task ID.',
  folderOccupied: 'The path “{path}” is occupied by a file.',
  fileMissing: 'The file “{path}” was not found. Restore it or change the path in settings.',
  notFile: '“{path}” is not a file.',
  pathChangedAction: 'The task file changed. Repeat the action in the current list.',
  changeNotSaved: 'The task change was not saved.',
  saveFailed: 'Could not save tasks: {message}',
  taskConflict: 'The task changed in the file. Refresh the list and try again.',
  alreadyCompleted: 'The task is already completed.',
  alreadyActive: 'The task is already active.',
  deleteArchivedTask: 'Delete archived task “{title}”',
  clearArchive: 'Clear archive',
  deleteTaskTitle: 'Delete this archived task?',
  deleteTaskDescription: 'The task “{title}” will be removed from the archive.',
  clearArchiveTitle: 'Clear the entire archive?',
  clearArchiveDescription: 'All completed tasks will be deleted: {count}. Search does not limit this action.',
  deleteTaskConfirm: 'Delete task',
  clearArchiveConfirm: 'Clear entire archive',
  archiveRemoved: 'Archived tasks deleted: {count}.',
  archiveRemovalFailed: 'Could not delete the archived tasks.',
  deleteActiveForbidden: 'Only completed tasks in the archive can be deleted.',
  archiveChanged: 'The archive changed. Review the updated list and try again.',
  archiveEmpty: 'The archive is already empty.',
  archiveUndoConflict: 'Some deleted tasks are already in the file. Undo was not applied.',
  reorderConflict: 'The task order changed. Review the list and try again.',
  reorderInvalid: 'Only active tasks within the same group can be reordered.',
  reorderFailed: 'Could not change the task order.',
  dragTask: 'Drag to reorder task: {title}',
  dragKeyboardHelp: 'Alt + ↑/↓ — move the task with the keyboard',
  reorderAnnouncement: 'Task “{title}”: position {position} of {count}.',
};

export function resolveLanguage(preference: LanguagePreference, appLanguage: string): Language {
  if (preference !== 'auto') return preference;
  return appLanguage.toLowerCase().split(/[-_]/)[0] === 'ru' ? 'ru' : 'en';
}

export class I18n {
  private listeners = new Set<() => void>();
  private readonly dateFormats = new Map<string, Intl.DateTimeFormat>();
  constructor(private preference: LanguagePreference = 'ru', private readonly appLanguage: () => string = () => 'en') {}
  get language(): Language { return resolveLanguage(this.preference, this.appLanguage()); }
  get locale(): string { return this.language === 'ru' ? 'ru-RU' : 'en-US'; }
  t(key: MessageKey, params: MessageParams = {}): string {
    return (this.language === 'ru' ? ru[key] : en[key]).replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
  }
  setPreference(preference: LanguagePreference): void {
    this.preference = preference;
    for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  error(error: unknown, fallback: MessageKey = 'unknownError'): string {
    if (error instanceof LocalizedError) return error.render(this);
    if (typeof error === 'string') return error;
    return error instanceof Error ? error.message : this.t(fallback);
  }
  formatDate(date: string): string {
    const locale = this.locale;
    let format = this.dateFormats.get(locale);
    if (!format) {
      format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
      this.dateFormats.set(locale, format);
    }
    return format.format(new Date(date));
  }
}

export class LocalizedError extends Error {
  constructor(public readonly key: MessageKey, public readonly params: MessageParams = {}, public readonly detail?: unknown) {
    super('');
    this.name = 'LocalizedError';
    this.message = this.render(new I18n('ru'));
  }
  render(i18n: I18n): string {
    return i18n.t(this.key, {...this.params, ...(this.detail === undefined ? {} : {message: i18n.error(this.detail)})});
  }
}
