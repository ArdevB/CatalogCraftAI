/**
 * Slowly drifting colour behind the app — decorative only.
 *
 * Performance: the soft edges come from radial gradients, not a blur filter,
 * and the drift only moves them (transform), so the graphics card handles it
 * without repainting anything — no lag, even with frosted panels on top.
 */
export function BackgroundGlow() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden dark:opacity-40">
      <div className="absolute -right-56 -top-64 size-[46rem] rounded-full bg-[radial-gradient(circle,var(--color-indigo-300)_0%,transparent_65%)] opacity-40 will-change-transform animate-drift-a" />
      <div className="absolute -bottom-72 left-1/4 size-[42rem] rounded-full bg-[radial-gradient(circle,var(--color-sky-200)_0%,transparent_65%)] opacity-50 will-change-transform animate-drift-b" />
      <div className="absolute right-1/4 top-1/3 size-[32rem] rounded-full bg-[radial-gradient(circle,var(--color-violet-200)_0%,transparent_65%)] opacity-40 will-change-transform animate-drift-c" />
    </div>
  );
}
