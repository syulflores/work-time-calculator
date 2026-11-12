(() => {
  if (window.__workTimeRelayV1) return;
  const source = window.__workTimeSource || "paychex";
  if (!source) return;
  if (!globalThis.chrome?.runtime?.id || !globalThis.chrome?.storage?.local) return;
  let active = true;
  function stop() {
    active = false;
    window.removeEventListener("message", onCapture);
    try {
      chrome.runtime?.onMessage?.removeListener(onRequest);
      chrome.storage?.onChanged?.removeListener(onModeChange);
    } catch {
      // Extension updates can invalidate the APIs before cleanup runs.
    }
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
      (value.source !== "paychex" || value.normalizationVersion === 2) &&
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
    const capture = { schemaVersion: 1, normalizationVersion: ev.data.normalizationVersion,
      source: ev.data.source, entries: ev.data.entries, at: ev.data.at };
    latest.set(capture.source, capture);
    try {
      if (!chrome.runtime?.id || !chrome.storage?.local) {
        stop();
        return;
      }
      chrome.storage.local.set({ ["capturedTimecard:" + capture.source]: capture }).catch((error) => {
        console.error("Unable to save captured timecard:", error);
      });
    } catch (error) {
      if (error.message?.includes("Extension context invalidated")) {
        stop();
        return;
      }
      console.error("Unable to save captured timecard:", error);
    }
  }
  window.addEventListener("message", onCapture);
  function withInputs(capture, msg) {
    const { today, first, last, now } = msg;
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (![today, first, last].every((value) => day.test(value || "")) ||
        first > today || last < today || !Number.isSafeInteger(now) ||
        !["day", "week"].includes(msg.periodMode))
      return { error: "Invalid calculation period." };
    const begin = msg.periodMode === "day" ? today : first;
    const end = msg.periodMode === "day" ? today : last;
    const seen = new Set();
    const rows = capture.entries.filter((row) => {
      const key = JSON.stringify(row);
      if (row.nonwork || row.date < begin || row.date > end || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    function summarize(date) {
      const daily = rows.filter((row) => row.date === date);
      const punches = daily.filter((row) => row.in !== null && row.in <= now).sort((a, b) => a.in - b.in);
      let gap = 0, coveredUntil = null;
      for (const row of punches) {
        if (coveredUntil !== null && row.in > coveredUntil) gap += (row.in - coveredUntil) / 1000;
        const finish = row.out === null ? now : Math.min(now, Math.max(row.in, row.out));
        coveredUntil = Math.max(coveredUntil ?? row.in, finish);
      }
      return { firstClockIn: punches[0]?.in ?? null,
        paidSeconds: daily.reduce((sum, row) => sum + row.regular + row.ot, 0),
        totalUnpaid: daily.length ? Math.max(gap, daily.reduce((sum, row) => sum + row.unpaid, 0)) : null,
        records: daily.length };
    }
    const days = Object.fromEntries([...new Set(rows.map((row) => row.date))].map((date) => [date, summarize(date)]));
    const daily = summarize(today);
    return { ...capture, inputs: {
      today, first: begin, last: end,
      days,
      firstClockIn: daily.firstClockIn,
      previousPaid: rows.filter((row) => row.date < today).reduce((sum, row) => sum + row.regular + row.ot, 0),
      totalUnpaid: daily.totalUnpaid ?? 0,
      todayRecords: daily.records,
    } };
  }
  function onRequest(msg, sender, respond) {
    if (!active || msg?.type !== "WORK_TIME_READ") return;
    if (msg.source !== source) {
      respond({ error: "Invalid timecard source." });
      return;
    }
    const missing = { error: "No timecard captured. Reload your timecard page, then click Refresh." };
    const capture = latest.get(msg.source);
    if (capture) {
      respond(withInputs(capture, msg));
      return;
    }
    const key = "capturedTimecard:" + msg.source;
    try {
      if (!chrome.runtime?.id || !chrome.storage?.local) {
        respond({ error: "Extension context unavailable. Reload your timecard page, then click Refresh." });
        stop();
        return;
      }
      chrome.storage.local.get(key).then((saved) => {
        const stored = saved[key];
        respond(isTimecardCapture(stored) && stored.source === msg.source ? withInputs(stored, msg) : missing);
      }).catch((error) => respond({ error: "Unable to read captured timecard: " + error.message }));
    } catch (error) {
      respond({ error: "Unable to read captured timecard: " + error.message });
      stop();
      return;
    }
    return true;
  }
  chrome.runtime.onMessage.addListener(onRequest);
  chrome.storage.onChanged.addListener(onModeChange);
})();
