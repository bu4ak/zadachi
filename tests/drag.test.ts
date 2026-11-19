// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDrag, type DragRow } from '../src/task-drag';

function rect(top: number, bottom: number, left = 0, right = 600): DOMRect {
  return { x: left, y: top, top, bottom, left, right, width: right - left, height: bottom - top, toJSON: () => ({}) } as DOMRect;
}
function pointer(type: string, x: number, y: number, pointerId = 1): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'mouse' },
    isPrimary: { value: true },
  });
  return event as PointerEvent;
}
function fixture() {
  const panel = document.createElement('div');
  const group = document.createElement('div');
  document.body.appendChild(panel);
  panel.appendChild(group);
  panel.getBoundingClientRect = () => rect(0, 600);
  group.getBoundingClientRect = () => rect(80, 230);
  const rows: DragRow[] = ['one', 'two', 'three'].map((id, index) => {
    const node = document.createElement('div');
    node.getBoundingClientRect = () => rect(100 + index * 40, 140 + index * 40);
    group.appendChild(node);
    return { id, node };
  });
  const handle = document.createElement('button');
  rows[1].node.appendChild(handle);
  const onDrop = vi.fn();
  const onEnd = vi.fn();
  const start = () => new TaskDrag(handle, rows[1], rows, panel, pointer('pointerdown', 30, 160), onDrop, onEnd);
  const placeholder = () => [...group.children].find(element => !rows.some(row => row.node === element)) as HTMLElement | undefined;
  const flowOrder = () => [...group.children].filter(element => element !== rows[1].node);
  return { panel, group, rows, handle, onDrop, onEnd, start, placeholder, flowOrder };
}

/** jsdom has no layout. Derive live row positions from the current DOM order. */
function liveFixture(grabY: number) {
  const f = fixture();
  const source = f.rows[1].node;
  for (const row of f.rows) {
    row.node.getBoundingClientRect = () => {
      const flow = [...f.group.children].filter(element => element !== source || source.style.position !== 'fixed');
      const index = flow.indexOf(row.node);
      return rect(100 + index * 40, 140 + index * 40);
    };
  }
  const start = () => new TaskDrag(f.handle, f.rows[1], f.rows, f.panel, pointer('pointerdown', 30, grabY), f.onDrop, f.onEnd);
  return { ...f, start };
}
beforeEach(() => document.body.replaceChildren());
afterEach(() => document.body.replaceChildren());

describe('Перетаскивание указателем', () => {
  it('перемещает исходную строку и сдвигает соседей через placeholder', () => {
    const f = fixture();
    const original = f.rows.map(row => row.node);
    const originalStyle = f.rows[1].node.style.cssText;
    f.onDrop.mockImplementation(() => {
      expect([...f.group.children]).toEqual(original);
      expect(f.rows[1].node.style.cssText).toBe(originalStyle);
      expect(f.placeholder()).toBeUndefined();
    });
    f.start();
    document.dispatchEvent(pointer('pointermove', 30, 105));
    const placeholder = f.placeholder();
    expect(placeholder).toBeDefined();
    expect(placeholder?.style.height).toBe('40px');
    expect(f.flowOrder()).toEqual([placeholder, f.rows[0].node, f.rows[2].node]);
    expect(f.rows[1].node.style.position).toBe('fixed');
    const transform = f.rows[1].node.style.transform;
    document.dispatchEvent(pointer('pointermove', 30, 95));
    expect(f.rows[1].node.style.transform).not.toBe(transform);
    expect(document.querySelector('.zadachi-drag-ghost')).toBeNull();
    document.dispatchEvent(pointer('pointerup', 30, 95));
    expect(f.onDrop).toHaveBeenCalledExactlyOnceWith({ anchorId: 'one', direction: 'up' });
    expect(f.onEnd).toHaveBeenCalledOnce();
    document.dispatchEvent(pointer('pointerup', 30, 105));
    expect(f.onDrop).toHaveBeenCalledOnce();
  });

  it.each([[590, 142], [5, 178]])('сохраняет точку захвата (%i, %i) внутри смещённой панели', (x, y) => {
    const f = fixture();
    const node = f.rows[1].node;
    const original = rect(140, 180);
    let scrolled = 0;
    node.getBoundingClientRect = () => node.style.position === 'fixed'
      ? rect(260 - scrolled, 300 - scrolled, 150, 750) : original;
    new TaskDrag(f.handle, f.rows[1], f.rows, f.panel, pointer('pointerdown', x, y), f.onDrop, f.onEnd);
    document.dispatchEvent(pointer('pointermove', x - 10, y - 40));
    // The same grabbed point must land at the current pointer, even with a fixed containing block.
    expect(node.style.transform).toBe('translate3d(-160px, -160px, 0)');
    scrolled = 25;
    document.dispatchEvent(pointer('pointermove', x - 20, y - 50));
    expect(node.style.transform).toBe('translate3d(-170px, -145px, 0)');
    document.dispatchEvent(pointer('pointercancel', x - 20, y - 50));
    expect(node.hasAttribute('style')).toBe(false);
  });

  it('перемещает placeholder вниз, а возврат на исходное место не сохраняет порядок', () => {
    const f = fixture();
    f.start();
    document.dispatchEvent(pointer('pointermove', 30, 219));
    const placeholder = f.placeholder();
    expect(f.flowOrder()).toEqual([f.rows[0].node, f.rows[2].node, placeholder]);
    document.dispatchEvent(pointer('pointermove', 30, 160));
    expect(f.flowOrder()).toEqual([f.rows[0].node, placeholder, f.rows[2].node]);
    document.dispatchEvent(pointer('pointerup', 30, 160));
    expect(f.onDrop).not.toHaveBeenCalled();
    expect([...f.group.children]).toEqual(f.rows.map(row => row.node));
    expect(f.placeholder()).toBeUndefined();
  });

  it.each([
    ['верх', 142, -1], ['низ', 178, -1],
    ['верх', 142, 1], ['низ', 178, 1],
  ] as const)('переставляет строку на 24 px, захват %s, направление %i', (_edge, grabY, direction) => {
    const f = liveFixture(grabY);
    f.start();
    document.dispatchEvent(pointer('pointermove', 30, grabY + direction * 24));
    const placeholder = f.placeholder();
    expect(placeholder).toBeDefined();
    const movedOrder = direction < 0
      ? [placeholder, f.rows[0].node, f.rows[2].node]
      : [f.rows[0].node, f.rows[2].node, placeholder];
    expect(f.flowOrder()).toEqual(movedOrder);

    // A 5 px reversal stays inside the hysteresis band.
    document.dispatchEvent(pointer('pointermove', 30, grabY + direction * 19));
    expect(f.flowOrder()).toEqual(movedOrder);

    // Crossing the opposite threshold moves the slot back.
    document.dispatchEvent(pointer('pointermove', 30, grabY + direction * 16));
    expect(f.flowOrder()).toEqual([f.rows[0].node, placeholder, f.rows[2].node]);
    document.dispatchEvent(pointer('pointerup', 30, grabY + direction * 16));
    expect(f.onDrop).not.toHaveBeenCalled();
    expect([...f.group.children]).toEqual(f.rows.map(row => row.node));
  });

  it.each([
    [142, -1, 'one', 'up'],
    [178, 1, 'three', 'down'],
  ] as const)('сохраняет цель после отпускания на расстоянии 24 px', (grabY, direction, anchorId, expectedDirection) => {
    const f = liveFixture(grabY);
    f.start();
    document.dispatchEvent(pointer('pointermove', 30, grabY + direction * 24));
    document.dispatchEvent(pointer('pointerup', 30, grabY + direction * 24));
    expect(f.onDrop).toHaveBeenCalledExactlyOnceWith({ anchorId, direction: expectedDirection });
    expect([...f.group.children]).toEqual(f.rows.map(row => row.node));
  });

  it.each(['pointercancel', 'Escape'] as const)('отменяет жест при %s и восстанавливает DOM', cancel => {
    const f = fixture();
    f.rows[1].node.style.color = 'red';
    const style = f.rows[1].node.style.cssText;
    f.start();
    document.dispatchEvent(pointer('pointermove', 30, 105));
    expect(f.placeholder()).toBeDefined();
    if (cancel === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else document.dispatchEvent(pointer(cancel, 30, 105));
    document.dispatchEvent(pointer('pointerup', 30, 105));
    expect(f.onDrop).not.toHaveBeenCalled();
    expect(f.onEnd).toHaveBeenCalledOnce();
    expect([...f.group.children]).toEqual(f.rows.map(row => row.node));
    expect(f.rows[1].node.style.cssText).toBe(style);
    expect(f.placeholder()).toBeUndefined();
    expect(document.querySelector('.zadachi-drag-ghost')).toBeNull();
  });

  it.each([[700, 105], [30, 260]])('не переносит задачу за границы группы (%i, %i)', (x, y) => {
    const f = fixture();
    f.start();
    document.dispatchEvent(pointer('pointermove', 30, 105));
    expect(f.placeholder()).toBeDefined();
    document.dispatchEvent(pointer('pointermove', x, y));
    document.dispatchEvent(pointer('pointerup', x, y));
    expect(f.onDrop).not.toHaveBeenCalled();
    expect([...f.group.children]).toEqual(f.rows.map(row => row.node));
    expect(f.placeholder()).toBeUndefined();
    expect(document.querySelector('.zadachi-drag-ghost')).toBeNull();
  });

  it('игнорирует события другого указателя', () => {
    const f = fixture();
    f.start();
    document.dispatchEvent(pointer('pointermove', 30, 105, 2));
    document.dispatchEvent(pointer('pointerup', 30, 105, 2));
    expect(f.onDrop).not.toHaveBeenCalled();
    expect(f.onEnd).not.toHaveBeenCalled();
    document.dispatchEvent(pointer('pointercancel', 30, 105));
    expect(f.onEnd).toHaveBeenCalledOnce();
  });
});
