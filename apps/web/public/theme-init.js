// Applies the saved light/dark theme before the page is drawn, so there is no
// flash of the wrong theme. Kept as a tiny separate file because the page's
// security policy allows no inline scripts. Mirrors src/lib/theme.ts.
(function () {
  var preference = 'system';
  try {
    preference = localStorage.getItem('catalogcraft:theme') || 'system';
  } catch {
    // Storage blocked: follow the system setting.
  }
  var dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
