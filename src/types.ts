export interface Task {
  id: string;
  title: string;
  note: string;
  urgent: boolean;
  important: boolean;
  createdAt: string;
  completedAt: string | null;
  order?: number;
}

export interface TaskDraft {
  title: string;
  note: string;
  urgent: boolean;
  important: boolean;
}

export interface TaskSnapshot {
  tasks: readonly Task[];
  loading: boolean;
  error: string | null;
  errorCause?: unknown;
}

export interface ArchiveRemoval {
  tasks: readonly Task[];
  storagePath: string;
}

export interface TaskService {
  getSnapshot(): TaskSnapshot;
  subscribe(listener: () => void): () => void;
  getPath(): string;
  load(): Promise<void>;
  add(draft: TaskDraft): Promise<Task>;
  update(original: Task, draft: TaskDraft): Promise<Task>;
  complete(original: Task): Promise<Task>;
  restore(original: Task): Promise<Task>;
  deleteArchived(original: Task): Promise<ArchiveRemoval>;
  clearArchive(originals: readonly Task[]): Promise<ArchiveRemoval>;
  undoArchiveRemoval(removal: ArchiveRemoval): Promise<void>;
  moveTask(original: Task, anchor: Task, direction: 'up' | 'down', group: readonly Task[]): Promise<void>;
}

export type TaskTab = 'active' | 'archive';

export const VIEW_TYPE = 'zadachi-view';
