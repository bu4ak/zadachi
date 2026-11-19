import { setIcon } from 'obsidian';

export function createPriorityToggle(
  kind: 'urgent' | 'important',
  text: string,
  pressed: boolean,
  onChange?: (pressed: boolean) => void,
) {
  const button = createEl('button', { attr: { type: 'button' }, cls: `zadachi-flag zadachi-flag-${kind}` });
  const icon = button.createSpan({ cls: 'zadachi-flag-icon', attr: { 'aria-hidden': 'true' } });
  setIcon(icon, kind === 'urgent' ? 'zap' : 'star');
  const label = button.createSpan({ text });
  const toggle = {
    button,
    label,
    get pressed(): boolean { return button.getAttribute('aria-pressed') === 'true'; },
    setPressed(value: boolean): void { button.setAttribute('aria-pressed', String(value)); },
  };
  toggle.setPressed(pressed);
  button.addEventListener('click', () => {
    toggle.setPressed(!toggle.pressed);
    onChange?.(toggle.pressed);
  });
  return toggle;
}
