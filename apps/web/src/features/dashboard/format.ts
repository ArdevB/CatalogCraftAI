/** "Good morning" / "Good afternoon" / "Good evening" for the user's local time. */
export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago"… */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2629800],
    ['year', 31557600],
  ];
  let unit = units[0]!;
  for (const candidate of units) if (abs >= candidate[1]) unit = candidate;
  return relative.format(Math.round(seconds / unit[1]), unit[0]);
}

const AVATAR_TONES = [
  'tint-indigo',
  'tint-emerald',
  'tint-amber',
  'tint-sky',
  'tint-rose',
  'tint-violet',
];

/** Initials and a stable colour for a name, for small avatars. */
export function avatarFor(name: string): { initials: string; tone: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? '?') + (words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : (words[0]?.[1] ?? ''))).toUpperCase();
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { initials, tone: AVATAR_TONES[hash % AVATAR_TONES.length]! };
}
