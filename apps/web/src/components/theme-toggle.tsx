import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { setTheme, useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
];

const originOf = (event: MouseEvent<HTMLElement>) => {
  const box = event.currentTarget.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

/** Light / System / Dark, with a thumb that slides to the chosen option. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference } = useTheme();
  const index = OPTIONS.findIndex((option) => option.value === preference);
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('relative grid grid-cols-3 rounded-lg bg-muted p-1', className)}>
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-md bg-card shadow-sm ring-1 ring-border/60 transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={(event) => setTheme(option.value, originOf(event))}
          className={cn(
            'relative grid h-7 place-items-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-ring',
            preference === option.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <option.icon
            className={cn('size-4 transition-transform duration-500', preference === option.value && 'rotate-[360deg] scale-110')}
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
}

/** One button that flips between light and dark — for tight spaces like the collapsed sidebar. */
export function ThemeSwitchButton({ className }: { className?: string }) {
  const { resolved } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={(event) => setTheme(next, originOf(event))}
      className={cn(
        'relative grid size-9 place-items-center overflow-hidden rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
    >
      <Sun className={cn('absolute size-[18px] transition-all duration-500', resolved === 'dark' ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')} aria-hidden />
      <Moon className={cn('absolute size-[18px] transition-all duration-500', resolved === 'dark' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0')} aria-hidden />
    </button>
  );
}
