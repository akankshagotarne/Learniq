import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

export const ThemeToggle: React.FC<{ className?: string; showLabel?: boolean }> = ({
  className = '',
  showLabel = false,
}) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`relative p-2 rounded-xl border transition-all duration-200 flex items-center gap-2 ${
        isDark
          ? 'bg-white/10 hover:bg-white/15 border-white/15 text-yellow-300'
          : 'bg-[#F1F1FA] hover:bg-[#E7E7F2] border-[#E7E7F2] text-[#22243A]'
      } ${className}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 transition-transform rotate-0 scale-100" />
      ) : (
        <Moon className="w-4 h-4 transition-transform rotate-0 scale-100 text-[#6C63F2]" />
      )}
      {showLabel && (
        <span className="text-xs font-medium">
          {isDark ? 'Light Theme' : 'Dark Theme'}
        </span>
      )}
    </button>
  );
};

export default ThemeToggle;
