import { SunIcon, MoonIcon } from './Icons.js';

interface Props {
  theme: 'dark' | 'light';
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: Props) {
  return (
    <button
      className="btn btn-theme"
      onClick={onToggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
    </button>
  );
}
