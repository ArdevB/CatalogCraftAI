import { useSyncExternalStore } from 'react';

/**
 * Light / dark / system theme. The choice is stored in the browser and applied
 * as a `dark` class on <html> (public/theme-init.js applies it before the
 * first paint; this module keeps it in sync afterwards).
 */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'catalogcraft:theme';
const listeners = new Set<() => void>();

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

let preference: ThemePreference = typeof window === 'undefined' ? 'system' : readPreference();

function apply(): void {
  const dark = preference === 'dark' || (preference === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

// Follow the operating system while the preference is "system".
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (preference === 'system') {
      apply();
      listeners.forEach((listener) => listener());
    }
  });
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Changes the theme. With an origin point (the click), the new theme spreads
 * out from there as a growing circle, where the browser supports view
 * transitions and the user hasn't asked for reduced motion.
 */
export function setTheme(next: ThemePreference, origin?: { x: number; y: number }): void {
  const update = () => {
    preference = next;
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered next time — harmless.
    }
    apply();
    listeners.forEach((listener) => listener());
  };

  if (!origin || typeof document.startViewTransition !== 'function' || reducedMotion()) {
    update();
    return;
  }
  const transition = document.startViewTransition(update);
  void transition.ready.then(() => {
    const radius = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${origin.x}px ${origin.y}px)`, `circle(${radius}px at ${origin.x}px ${origin.y}px)`] },
      { duration: 600, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
}

/** The saved preference and the theme actually showing. */
export function useTheme(): { preference: ThemePreference; resolved: 'light' | 'dark' } {
  const current = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => preference,
    () => 'system' as const,
  );
  const resolved = current === 'dark' || (current === 'system' && systemPrefersDark()) ? 'dark' : 'light';
  return { preference: current, resolved };
}
