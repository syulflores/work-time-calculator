// Capture only Paychex's own successful timecard responses; never initiate a Paychex request.
(() => {
  if (window.__paychexHoursBridgeV3) return;
  let active = true;
  const pending = new Map();
  function stop() {
    active = false;
    if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
    if (XMLHttpRequest.prototype.open === wrappedOpen) XMLHttpRequest.prototype.open = originalOpen;
    if (XMLHttpRequest.prototype.send === wrappedSend) XMLHttpRequest.prototype.send = originalSend;
    for (const [xhr, handler] of pending) xhr.removeEventListener("load", handler);
    pending.clear();
    window.removeEventListener("message", onControl);
    delete window.__paychexHoursBridgeV3;
    if (window.__workTimeBridge?.stop === stop) delete window.__workTimeBridge;
  }
  function onControl(ev) {
    if (ev.source === window && ev.origin === location.origin &&
        ev.data?.channel === "work-time-capture-v1" && ev.data?.type === "stop") stop();
  }
  window.__paychexHoursBridgeV3 = { stop };
  window.__workTimeBridge = { stop };
  window.addEventListener("message", onControl);
  const CHANNEL = "work-time-capture-v1";
  const timestamp = (value) => {
    const match = /\/Date\((-?\d+)/.exec(value || "");
    return match ? Number(match[1]) : null;
  };
  const seconds = (value) => Math.max(0, Number(value) || 0);
  function capture(url, text) {
    if (!active || !String(url).includes("/GetTimeCardData")) return;
    try {
      const d = JSON.parse(text);
      const rows = d?.TimecardData?.TimeCardData;
      if (!Array.isArray(rows)) return;
      const entries = rows.map((x) => ({
        date: timestamp(x.ApplyToDate) === null ? null : new Date(timestamp(x.ApplyToDate)).toISOString().slice(0, 10),
        in: timestamp(x.DateTimeIn),
        out: timestamp(x.DateTimeOut),
        regular: seconds(x.RegDurationSecs),
        ot: seconds(x.OTDurationSecs),
        unpaid: seconds(x.UnpaidDurationSecs),
        nonwork: Boolean(x.IsNonWork),
        payType: String(x.PayTyeName || ""),
      }));
      window.postMessage(
        { channel: CHANNEL, type: "capture", schemaVersion: 1, source: "paychex", entries, at: Date.now() },
        location.origin,
      );
    } catch {}
  }
  const nativeFetch = window.fetch;
  const wrappedFetch = function (...args) {
    const p = nativeFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      p.then((r) => {
        if (active && r.ok && String(url).includes("GetTimeCardData"))
          r.clone()
            .text()
            .then((t) => capture(url, t))
            .catch(() => {});
      }).catch(() => {});
    } catch {}
    return p;
  };
  const originalOpen = XMLHttpRequest.prototype.open,
    originalSend = XMLHttpRequest.prototype.send;
  window.fetch = wrappedFetch;
  const wrappedOpen = function (method, url, ...rest) {
    this.__paychexHoursUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.open = wrappedOpen;
  const wrappedSend = function (...args) {
    if (this.__paychexHoursUrl?.includes("GetTimeCardData")) {
      const handler = () => {
        pending.delete(this);
        if (!active) return;
        if (
          this.status >= 200 &&
          this.status < 300 &&
          typeof this.responseText === "string"
        )
          capture(this.__paychexHoursUrl, this.responseText);
      };
      pending.set(this, handler);
      this.addEventListener("load", handler, { once: true });
    }
    return originalSend.apply(this, args);
  };
  XMLHttpRequest.prototype.send = wrappedSend;
})();
