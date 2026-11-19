import { setIcon } from 'obsidian';

export function createPriorityToggle(
  kind: 'urgent' | 'important',
  text: string,
  pressed: boolean,
  onChange?: (pressed: boolean) => void,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `zadachi-flag zadachi-flag-${kind}`;
  const icon = document.createElement('span');
  icon.className = 'zadachi-flag-icon';
  icon.setAttribute('aria-hidden', 'true');
  setIcon(icon, kind === 'urgent' ? 'zap' : 'star');
  const label = document.createElement('span');
  label.textContent = text;
  button.append(icon, label);
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
