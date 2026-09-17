import type { KeyboardEvent as ReactKeyboardEvent, FocusEvent as ReactFocusEvent } from 'react';

export function handleColumnNav(e: ReactKeyboardEvent<HTMLInputElement>, col: string) {
    if (e.key !== 'Tab' && e.key !== 'Enter') return;
    e.preventDefault();
    const table = (e.target as HTMLElement).closest('table, .space-y-3');
    if (!table) return;
    const inputs = Array.from(table.querySelectorAll(`input[data-col="${col}"]`)) as HTMLInputElement[];
    const idx = inputs.indexOf(e.target as HTMLInputElement);
    if (idx === -1) return;
    const next = e.shiftKey
        ? (idx > 0 ? idx - 1 : inputs.length - 1)
        : (idx < inputs.length - 1 ? idx + 1 : 0);
    inputs[next].focus();
    inputs[next].select();
}

export function selectOnFocus(e: ReactFocusEvent<HTMLInputElement>) {
    e.target.select();
}