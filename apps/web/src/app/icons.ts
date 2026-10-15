// 16px stroke icons, drawn to match the 1.5px UI weight.
const svg = (d: string) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONS = {
  undo: svg('<path d="M5.5 3.5 2.5 6.5l3 3"/><path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7h-2"/>'),
  redo: svg('<path d="m10.5 3.5 3 3-3 3"/><path d="M13.5 6.5h-7a3.5 3.5 0 0 0 0 7h2"/>'),
  minus: svg('<path d="M3.5 8h9"/>'),
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  link: svg('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.3-2.3a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.2 9.1a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/>'),
  help: svg('<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 0 1 3.5.6c0 1.2-1.8 1.5-1.8 2.6"/><path d="M8 11.6v.1"/>'),
  compare: svg('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M8 3v10"/><path d="M8 3h4a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 12 13H8z" fill="currentColor" stroke="none" opacity=".35"/>'),
};
