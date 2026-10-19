/** Slowly drifting colour behind the app — decorative only. */
export function BackgroundGlow() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden dark:opacity-40">
      <div className="absolute -right-40 -top-48 size-[38rem] rounded-full bg-indigo-300/25 blur-3xl animate-drift-a" />
      <div className="absolute -bottom-56 left-1/4 size-[34rem] rounded-full bg-sky-200/30 blur-3xl animate-drift-b" />
      <div className="absolute right-1/4 top-1/3 size-[26rem] rounded-full bg-violet-200/25 blur-3xl animate-drift-c" />
    </div>
  );
}
