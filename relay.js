(() => {
  if (window.__workTimeRelayV1) return;
  const source = window.__workTimeSource;
  if (!source) return;
  let active = true;
  function stop() {
    active = false;
    window.removeEventListener("message", onCapture);
    chrome.runtime.onMessage.removeListener(onRequest);
    chrome.storage.onChanged.removeListener(onModeChange);
    window.postMessage({ channel: CHANNEL, type: "stop" }, location.origin);
    delete window.__workTimeRelayV1;
  }
  function onModeChange(changes, area) {
    if (area === "local" && changes.mode && changes.mode.newValue !== source) stop();
  }
  window.__workTimeRelayV1 = { stop };
  const CHANNEL = "work-time-capture-v1";
  const latest = new Map();
  function isTimecardCapture(value) {
    const timestamp = (v) => v === null || (Number.isSafeInteger(v) && Math.abs(v) <= 8640000000000000);
    const seconds = (v) => Number.isFinite(v) && v >= 0;
    return value?.schemaVersion === 1 &&
      /^[a-z][a-z0-9-]*$/.test(value.source || "") &&
      Number.isSafeInteger(value.at) && value.at > 0 &&
      Array.isArray(value.entries) && value.entries.every((row) =>
        row && /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
        timestamp(row.in) && timestamp(row.out) &&
        seconds(row.regular) && seconds(row.ot) && seconds(row.unpaid) &&
        typeof row.nonwork === "boolean" && typeof row.payType === "string"
      );
  }

  function onCapture(ev) {
    if (
      !active || ev.data?.source !== source ||
      ev.source !== window ||
      ev.origin !== location.origin ||
      ev.data?.channel !== CHANNEL ||
      ev.data?.type !== "capture" ||
      !isTimecardCapture(ev.data)
    )
      return;
    const capture = { schemaVersion: 1, source: ev.data.source, entries: ev.data.entries, at: ev.data.at };
    latest.set(capture.source, capture);
    try {
      if (!chrome.runtime?.id || !chrome.storage?.local) {
        window.removeEventListener("message", onCapture);
        return;
      }
      chrome.storage.local.set({ ["capturedTimecard:" + capture.source]: capture }).catch((error) => {
        console.error("Unable to save captured timecard:", error);
      });
    } catch (error) {
      if (error.message?.includes("Extension context invalidated")) {
        window.removeEventListener("message", onCapture);
        return;
      }
      console.error("Unable to save captured timecard:", error);
    }
  }
  window.addEventListener("message", onCapture);
  function onRequest(msg, sender, respond) {
    if (!active || msg?.type !== "WORK_TIME_READ") return;
    if (msg.source !== source) {
      respond({ error: "Invalid timecard source." });
      return;
    }
    const missing = { error: "No timecard captured. Reload your timecard page, then click Refresh." };
    const capture = latest.get(msg.source);
    if (capture) {
      respond(capture);
      return;
    }
    const key = "capturedTimecard:" + msg.source;
    chrome.storage.local.get(key).then((saved) => {
      const stored = saved[key];
      respond(isTimecardCapture(stored) && stored.source === msg.source ? stored : missing);
    }).catch((error) => respond({ error: "Unable to read captured timecard: " + error.message }));
    return true;
  }
  chrome.runtime.onMessage.addListener(onRequest);
  chrome.storage.onChanged.addListener(onModeChange);
})();
