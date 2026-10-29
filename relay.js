(() => {
  if (window.__paychexHoursRelayV2) return;
  window.__paychexHoursRelayV2 = true;
  const CHANNEL = "paychex-hours-capture-v2";
  let latest = null;
  window.addEventListener("message", (ev) => {
    if (
      ev.source !== window ||
      ev.origin !== location.origin ||
      ev.data?.channel !== CHANNEL ||
      ev.data?.type !== "capture" ||
      !Array.isArray(ev.data.entries)
    )
      return;
    latest = { entries: ev.data.entries, at: ev.data.at };
    chrome.storage.local.set({ capturedTimecard: latest });
  });
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg?.type !== "PAYCHEX_HOURS_READ") return;
    respond(
      latest || {
        error:
          "No timecard response captured yet. Reload your Paychex timecard page, then click Refresh.",
      },
    );
  });
})();
