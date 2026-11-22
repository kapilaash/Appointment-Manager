// Runs before the first paint so the saved theme is applied without a light→dark flash.
// Kept as a tiny external file because the Content-Security-Policy forbids inline scripts.
(function () {
  var colors = { light: '#f8fafc', classic: '#f7f3e8', dark: '#09090b' };
  var theme = 'light';
  try {
    var preference = window.localStorage.getItem('thirumal-theme') || 'light';
    theme = preference === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;
    if (!colors[theme]) theme = 'light';
  } catch (error) {
    theme = 'light';
  }
  var root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', colors[theme]);
})();
