// ============================================================================
// ThemeToggle.tsx — Accessible Theme Toggle with Light, Dark, and System modes
// ============================================================================
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';

interface ThemeToggleProps {
  className?: string;
  showDropdown?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '', showDropdown = true }) => {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [menuOpen]);

  // Determine effective theme
  const isDarkEffective =
    theme === 'dark' ||
    (theme === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Quick primary toggle (switches between Light & Dark)
  const handleQuickToggle = (e: React.MouseEvent) => {
    // If Shift or right click, open dropdown
    if (e.shiftKey) {
      setMenuOpen(!menuOpen);
      return;
    }
    const nextTheme = isDarkEffective ? 'light' : 'dark';
    setTheme(nextTheme);
  };

  return (
    <div className={`relative inline-flex items-center ${className}`} ref={menuRef}>
      <motion.button
        type="button"
        onClick={handleQuickToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(!menuOpen);
        }}
        aria-label={`Toggle color theme. Current theme: ${theme}. Click to switch to ${isDarkEffective ? 'light' : 'dark'} mode.`}
        title={`Current: ${theme.toUpperCase()} mode (Click to switch to ${isDarkEffective ? 'light' : 'dark'}, right-click for options)`}
        className="relative p-2 rounded-full border border-slate-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 text-slate-600 dark:text-zinc-300 shadow-sm hover:border-[#8B5CF6]/50 dark:hover:border-[#8B5CF6]/50 hover:bg-[#8B5CF6]/5 dark:hover:bg-[#8B5CF6]/15 hover:text-[#8B5CF6] dark:hover:text-[#A78BFA] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6] cursor-pointer group"
        whileTap={{ scale: 0.92 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isDarkEffective ? (
            <motion.div
              key="sun"
              initial={{ rotate: -90, scale: 0.5, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{ rotate: 90, scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="text-amber-400 group-hover:drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]"
            >
              <Sun size={17} strokeWidth={2.2} />
            </motion.div>
          ) : (
            <motion.div
              key="moon"
              initial={{ rotate: 90, scale: 0.5, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{ rotate: -90, scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="text-indigo-600 group-hover:text-[#8B5CF6] group-hover:drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]"
            >
              <Moon size={17} strokeWidth={2.2} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Small system indicator dot if in system mode */}
        {theme === 'system' && (
          <span
            className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#8B5CF6] ring-2 ring-white dark:ring-zinc-900"
            title="System theme preference active"
          />
        )}
      </motion.button>

      {/* Optional Theme Selection Dropdown (Light / Dark / System) */}
      <AnimatePresence>
        {menuOpen && showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="absolute right-0 top-full mt-2 w-44 rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 shadow-2xl p-1.5 z-50 text-xs font-semibold backdrop-blur-xl"
            role="menu"
            aria-label="Theme options"
          >
            <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
              Theme Mode
            </div>

            <button
              type="button"
              onClick={() => {
                setTheme('light');
                setMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                theme === 'light'
                  ? 'bg-purple-50 dark:bg-purple-950/40 text-[#8B5CF6] dark:text-[#A78BFA] font-bold'
                  : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Sun size={15} className="text-amber-500" />
                <span>Light</span>
              </span>
              {theme === 'light' && <Check size={14} />}
            </button>

            <button
              type="button"
              onClick={() => {
                setTheme('dark');
                setMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                theme === 'dark'
                  ? 'bg-purple-50 dark:bg-purple-950/40 text-[#8B5CF6] dark:text-[#A78BFA] font-bold'
                  : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Moon size={15} className="text-indigo-400" />
                <span>Dark</span>
              </span>
              {theme === 'dark' && <Check size={14} />}
            </button>

            <button
              type="button"
              onClick={() => {
                setTheme('system');
                setMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                theme === 'system'
                  ? 'bg-purple-50 dark:bg-purple-950/40 text-[#8B5CF6] dark:text-[#A78BFA] font-bold'
                  : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Monitor size={15} className="text-slate-400 dark:text-zinc-400" />
                <span>System</span>
              </span>
              {theme === 'system' && <Check size={14} />}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
