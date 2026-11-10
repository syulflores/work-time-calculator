// Apply the last selected theme before the stylesheet paints the popup.
// chrome.storage remains authoritative; this cache only avoids a light flash.
try {
  document.documentElement.dataset.theme = localStorage.getItem("darkMode") === "true" ? "dark" : "light";
} catch {
  // The popup restores the saved preference even if the paint cache is unavailable.
}
