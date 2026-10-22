import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getInitialTheme,
  applyTheme,
  THEME_STORAGE_KEY,
  useAppStateStore,
} from './appStateStore';

describe('theme state management and persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  it('defaults to system theme when no stored preference exists', () => {
    expect(getInitialTheme()).toBe('system');
  });

  it('retrieves saved theme from localStorage when valid', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(getInitialTheme()).toBe('dark');

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(getInitialTheme()).toBe('light');

    localStorage.setItem(THEME_STORAGE_KEY, 'invalid');
    expect(getInitialTheme()).toBe('system');
  });

  it('applies dark theme by setting .dark class and data-theme attribute', () => {
    applyTheme('dark');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('applies light theme by removing .dark class and setting data-theme to light', () => {
    document.documentElement.classList.add('dark');
    applyTheme('light');

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('respects system prefers-color-scheme media query when theme is system', () => {
    // Mock matchMedia for dark mode
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-color-scheme: dark'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    applyTheme('system');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('setTheme in useAppStateStore updates store and applies theme', () => {
    useAppStateStore.getState().setTheme('dark');
    expect(useAppStateStore.getState().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    useAppStateStore.getState().setTheme('light');
    expect(useAppStateStore.getState().theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
