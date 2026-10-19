import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeSwitchButton, ThemeToggle } from '@/components/theme-toggle';
import { setTheme } from '@/lib/theme';

afterEach(() => setTheme('system'));

describe('theme', () => {
  it('switches between light, dark and the system setting, and remembers the choice', async () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('catalogcraft:theme')).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('catalogcraft:theme')).toBe('light');

    await userEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(localStorage.getItem('catalogcraft:theme')).toBeNull(); // follows the operating system again
  });

  it('offers a one-click switch for tight spaces', async () => {
    render(<ThemeSwitchButton />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });
});
