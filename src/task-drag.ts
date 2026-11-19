export interface DragRow { id: string; node: HTMLElement }
export interface DropTarget { anchorId: string; direction: 'up' | 'down' }

/** Compute insertion relative to visible neighbours, without changing the DOM. */
export function dragTarget(sourceId: string, rows: readonly DragRow[], y: number): DropTarget | null {
  const oldIndex = rows.findIndex(row => row.id === sourceId);
  if (oldIndex < 0) return null;
  const others = rows.filter(row => row.id !== sourceId);
  let index = 0;
  for (const row of others) {
    const rect = row.node.getBoundingClientRect();
    if (y >= rect.top + rect.height / 2) index++;
    else break;
  }
  if (index === oldIndex) return null;
  if (index < oldIndex) return { anchorId: others[index].id, direction: 'up' };
  return { anchorId: others[index - 1].id, direction: 'down' };
}

/** One pointer gesture. Every exit path removes listeners and transient DOM. */
export class TaskDrag {
  private readonly doc: Document;
  private readonly win: Window | null;
  private readonly pointerId: number;
  private readonly startX: number;
  private readonly startY: number;
  private readonly grabX: number;
  private readonly grabY: number;
  private x: number;
  private y: number;
  private dragging = false;
  private done = false;
  private raf: number | null = null;
  private placeholder: HTMLElement | null = null;
  private readonly group: HTMLElement | null;
  private readonly nextSibling: ChildNode | null;
  private readonly originalStyle: string | null;
  private sourceRect: DOMRect | null = null;
  private slot = 0;
  private target: DropTarget | null = null;

  constructor(
    private readonly handle: HTMLButtonElement,
    private readonly source: DragRow,
    private readonly rows: readonly DragRow[],
    private readonly scrollHost: HTMLElement,
    event: PointerEvent,
    private readonly onDrop: (target: DropTarget) => void,
    private readonly onEnd: () => void,
  ) {
    this.group = source.node.parentElement;
    this.nextSibling = source.node.nextSibling;
    this.originalStyle = source.node.getAttribute('style');
    this.slot = rows.findIndex(row => row.id === source.id);
    this.doc = handle.ownerDocument;
    this.win = this.doc.defaultView;
    this.pointerId = event.pointerId;
    this.startX = this.x = event.clientX;
    this.startY = this.y = event.clientY;
    const grabbedRect = source.node.getBoundingClientRect();
    this.grabX = event.clientX - grabbedRect.left;
    this.grabY = event.clientY - grabbedRect.top;
    this.doc.addEventListener('pointermove', this.onMove, { capture: true, passive: false });
    this.doc.addEventListener('pointerup', this.onUp, true);
    this.doc.addEventListener('pointercancel', this.onCancelPointer, true);
    this.doc.addEventListener('keydown', this.onKey, true);
    this.handle.addEventListener('lostpointercapture', this.onLostCapture);
    this.win?.addEventListener('blur', this.onBlur);
    try { this.handle.setPointerCapture?.(this.pointerId); } catch { /* Pointer capture is unavailable on some platforms. */ }
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    this.doc.removeEventListener('pointermove', this.onMove, true);
    this.doc.removeEventListener('pointerup', this.onUp, true);
    this.doc.removeEventListener('pointercancel', this.onCancelPointer, true);
    this.doc.removeEventListener('keydown', this.onKey, true);
    this.handle.removeEventListener('lostpointercapture', this.onLostCapture);
    this.win?.removeEventListener('blur', this.onBlur);
    if (this.raf !== null) this.win?.cancelAnimationFrame(this.raf);
    this.raf = null;
    this.restorePreview();
    try { if (this.handle.hasPointerCapture?.(this.pointerId)) this.handle.releasePointerCapture(this.pointerId); } catch { /* Already released. */ }
    this.onEnd();
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || this.done) return;
    this.x = event.clientX;
    this.y = event.clientY;
    if (!this.dragging && Math.hypot(this.x - this.startX, this.y - this.startY) < 6) return;
    if (!this.dragging) {
      this.dragging = true;
      this.startPreview();
    }
    if (event.cancelable) event.preventDefault();
    this.updateTarget();
    this.scheduleScroll();
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId || this.done) return;
    if (this.dragging && (event.clientX !== this.x || event.clientY !== this.y)) {
      this.x = event.clientX;
      this.y = event.clientY;
      this.updateTarget();
    }
    const target = this.dragging ? this.target : null;
    this.cancel();
    if (target) this.onDrop(target);
  };

  private readonly onCancelPointer = (event: PointerEvent): void => { if (event.pointerId === this.pointerId) this.cancel(); };
  private readonly onLostCapture = (event: PointerEvent): void => { if (event.pointerId === this.pointerId) this.cancel(); };
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); this.cancel(); }
  };
  private readonly onBlur = (): void => this.cancel();

  private startPreview(): void {
    if (!this.group) return;
    const node = this.source.node;
    this.sourceRect = node.getBoundingClientRect();
    const gap = createDiv({ cls: 'zadachi-drag-placeholder', attr: { 'aria-hidden': 'true' } });
    gap.setCssStyles({ height: `${this.sourceRect.height}px` });
    this.group.insertBefore(gap, node);
    this.placeholder = gap;
    this.scrollHost.classList.add('zadachi-drag-active');
    node.classList.add('is-dragging');
    node.style.removeProperty('transform');
    node.setCssStyles({
      top: `${this.sourceRect.top}px`, left: `${this.sourceRect.left}px`,
      width: `${this.sourceRect.width}px`, height: `${this.sourceRect.height}px`,
    });
  }

  private restorePreview(): void {
    const node = this.source.node;
    if (this.placeholder && this.group) {
      const focused = this.doc.activeElement === this.handle;
      // Restore before the view applies the persisted order, including failed/cancelled drops.
      if (this.nextSibling?.parentNode === this.group) this.group.insertBefore(node, this.nextSibling);
      else this.group.appendChild(node);
      this.placeholder.remove();
      node.classList.remove('is-dragging');
      if (this.originalStyle === null) node.removeAttribute('style');
      else node.setAttribute('style', this.originalStyle);
      this.scrollHost.classList.remove('zadachi-drag-active');
      if (focused) this.handle.focus({ preventScroll: true });
    }
    this.placeholder = null;
  }

  private placeSlot(index: number): void {
    if (!this.group || !this.placeholder) return;
    const others = this.rows.filter(row => row.id !== this.source.id);
    const before = others[index]?.node ?? null;
    if (before) this.group.insertBefore(this.placeholder, before);
    else this.group.appendChild(this.placeholder);
    this.slot = index;
    const oldIndex = this.rows.findIndex(row => row.id === this.source.id);
    this.target = index === oldIndex ? null : index < oldIndex
      ? { anchorId: others[index].id, direction: 'up' }
      : { anchorId: others[index - 1].id, direction: 'down' };
  }

  private updateTarget(): void {
    if (!this.placeholder || !this.sourceRect) return;
    const node = this.source.node;
    // Obsidian panes can establish a containing block for fixed descendants.
    // Measure its real origin instead of treating viewport coordinates as local ones.
    node.style.removeProperty('--zadachi-drag-offset');
    const fixedRect = node.getBoundingClientRect();
    node.setCssProps({ '--zadachi-drag-offset': `translate3d(${this.x - this.grabX - fixedRect.left}px, ${this.y - this.grabY - fixedRect.top}px, 0)` });
    const rect = this.group?.getBoundingClientRect();
    const panel = this.scrollHost.getBoundingClientRect();
    const inside = rect && this.x >= rect.left && this.x <= rect.right && this.x >= panel.left && this.x <= panel.right &&
      this.y >= rect.top && this.y <= rect.bottom && this.y >= panel.top && this.y <= panel.bottom;
    if (!inside) {
      this.placeSlot(this.rows.findIndex(row => row.id === this.source.id));
      return;
    }
    const others = this.rows.filter(row => row.id !== this.source.id);
    const top = this.y - this.grabY;
    const bottom = top + this.sourceRect.height;
    const midpoint = (row: DragRow) => {
      const box = row.node.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    // Swap when the leading edge reaches the neighbour's middle, not its far edge.
    // A small overlap prevents repeated swaps when the pointer rests at the boundary.
    const overlap = 3;
    let index = this.slot;
    if (index > 0 && top < midpoint(others[index - 1]) - overlap) {
      while (index > 0 && top < midpoint(others[index - 1]) - overlap) index--;
    } else if (index < others.length && bottom > midpoint(others[index]) + overlap) {
      while (index < others.length && bottom > midpoint(others[index]) + overlap) index++;
    }
    if (index !== this.slot) this.placeSlot(index);
  }

  private scheduleScroll(): void {
    if (!this.win || this.raf !== null) return;
    const rect = this.scrollHost.getBoundingClientRect();
    if (this.x < rect.left || this.x > rect.right || this.y < rect.top || this.y > rect.bottom) return;
    const velocity = this.y < rect.top + 40 ? -Math.ceil((rect.top + 40 - this.y) / 4)
      : this.y > rect.bottom - 40 ? Math.ceil((this.y - rect.bottom + 40) / 4) : 0;
    if (!velocity) return;
    this.raf = this.win.requestAnimationFrame(() => {
      this.raf = null;
      if (this.done) return;
      const before = this.scrollHost.scrollTop;
      this.scrollHost.scrollTop += velocity;
      this.updateTarget();
      if (this.scrollHost.scrollTop !== before) this.scheduleScroll();
    });
  }
}
