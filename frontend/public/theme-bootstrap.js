(function bootstrapWordflowTheme() {
  var storageKey = 'ldaca-color-theme-v1';
  var lightTheme = 'light-2026';
  var darkTheme = 'dark-2026';
  var theme = lightTheme;

  try {
    var stored = window.localStorage.getItem(storageKey);
    if (stored === lightTheme || stored === darkTheme) theme = stored;
  } catch (_error) {
    // Storage can be unavailable in private or locked-down browser contexts.
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === darkTheme ? 'dark' : 'light';
  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', theme === darkTheme ? '#191A1B' : '#FAFAFD');
})();
