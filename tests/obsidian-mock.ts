/** Minimal DOM surface used by the view. This is not a substitute for Obsidian. */
type ElementOptions = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string>;
  value?: string;
  type?: string;
  placeholder?: string;
  title?: string;
};

function configure(el: HTMLElement, options?: string | ElementOptions): void {
  if (typeof options === 'string') {
    el.className = options;
    return;
  }
  if (!options) return;
  if (options.cls) el.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.attr) Object.entries(options.attr).forEach(([key, value]) => el.setAttribute(key, value));
  for (const key of ['value', 'type', 'placeholder', 'title'] as const) {
    if (options[key] !== undefined) el.setAttribute(key, options[key]!);
  }
}

export function installObsidianDom(): void {
  Object.assign(globalThis, {
    createEl(tag: string, options?: string | ElementOptions) {
      const element = document.createElement(tag);
      configure(element, options);
      return element;
    },
    createDiv(options?: string | ElementOptions) { return createEl('div', options); },
    createFragment(callback?: (fragment: DocumentFragment) => void) {
      const fragment = document.createDocumentFragment();
      callback?.(fragment);
      return fragment;
    },
  });
  const proto = HTMLElement.prototype as any;
  proto.createEl = function (tag: string, options?: string | ElementOptions, callback?: (el: HTMLElement) => void) {
    const child = document.createElement(tag);
    configure(child, options);
    this.appendChild(child);
    callback?.(child);
    return child;
  };
  proto.createDiv = function (options?: string | ElementOptions, callback?: (el: HTMLElement) => void) {
    return this.createEl('div', options, callback);
  };
  proto.createSpan = function (options?: string | ElementOptions, callback?: (el: HTMLElement) => void) {
    return this.createEl('span', options, callback);
  };
  proto.empty = function () { this.replaceChildren(); };
  proto.setText = function (text: string) { this.textContent = text; };
  proto.setCssStyles = function (styles: Partial<CSSStyleDeclaration>) { Object.assign(this.style, styles); };
  proto.setCssProps = function (props: Record<string, string>) {
    Object.entries(props).forEach(([name, value]) => this.style.setProperty(name, value));
  };
  proto.addClass = function (...classes: string[]) { this.classList.add(...classes); };
  proto.removeClass = function (...classes: string[]) { this.classList.remove(...classes); };
  proto.toggleClass = function (name: string, enabled: boolean) { this.classList.toggle(name, enabled); };
  proto.setAttr = function (name: string, value: string) { this.setAttribute(name, value); };
  proto.setAttrs = function (attrs: Record<string, string>) {
    Object.entries(attrs).forEach(([key, value]) => this.setAttribute(key, value));
  };
}

export class ItemView {
  containerEl = document.createElement('div');
  contentEl = document.createElement('div');
  app: unknown;
  constructor(public leaf: { app?: unknown }) {
    this.app = leaf.app;
    this.containerEl.append(document.createElement('div'), this.contentEl);
  }
}

export class EditableFileView extends ItemView {
  file: { path: string; basename: string } | null = null;
  getState(): Record<string, unknown> { return this.file ? { file: this.file.path } : {}; }
  async setState(state: any, _result: unknown): Promise<void> {
    if (!state?.file) return;
    const app = this.app as { vault?: { getAbstractFileByPath(path: string): unknown } };
    const file = app.vault?.getAbstractFileByPath(state.file) as { path: string; basename: string } | null;
    if (file) {
      if (this.file && this.file !== file) await this.onUnloadFile(this.file);
      this.file = file;
      await this.onLoadFile(file);
    }
  }
  async onLoadFile(_file: { path: string; basename: string }): Promise<void> {}
  async onUnloadFile(_file: { path: string; basename: string }): Promise<void> {}
  async onRename(_file: { path: string; basename: string }): Promise<void> {}
  onPaneMenu(_menu: unknown, _source: string): void {}
}

export class Modal {
  modalEl = document.createElement('div');
  contentEl = document.createElement('div');
  titleEl = document.createElement('h2');
  constructor(public app: unknown) { this.modalEl.append(this.titleEl, this.contentEl); }
  open(): this {
    document.body.append(this.modalEl);
    (this as any).onOpen?.();
    return this;
  }
  close(): this {
    (this as any).onClose?.();
    this.modalEl.remove();
    return this;
  }
  setTitle(title: string): this { this.titleEl.textContent = title; return this; }
}

export class Notice {
  static instances: Notice[] = [];
  noticeEl = document.createElement('div');
  constructor(message: string | DocumentFragment | HTMLElement) {
    if (typeof message === 'string') this.noticeEl.textContent = message;
    else this.noticeEl.append(message);
    document.body.append(this.noticeEl);
    Notice.instances.push(this);
  }
  hide(): void { this.noticeEl.remove(); }
}

export function setIcon(el: HTMLElement, icon: string): void { el.dataset.icon = icon; }
export function setTooltip(el: HTMLElement, value: string): void { el.title = value; }
export function getLanguage(): string { return 'ru'; }
