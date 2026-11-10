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
    if (value === null || value === undefined || value === "") return null;
    const match = /\/Date\((-?\d+)/.exec(value || "");
    const ms = match ? Number(match[1]) : typeof value === "number" ? value : Date.parse(value);
    return Number.isSafeInteger(ms) && Math.abs(ms) <= 8640000000000000 ? ms : null;
  };
  const punchTimestamp = (value) => {
    const ms = timestamp(value);
    if (ms === null || !/^\/Date\(/.test(String(value))) return ms;
    // StratusTime serializes the displayed wall clock into .NET date UTC fields.
    // Reconstruct that clock locally; treating the payload as an instant shifts
    // a 09:24 Chicago punch to 03:24 during standard time.
    const clock = new Date(ms);
    return new Date(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate(),
      clock.getUTCHours(), clock.getUTCMinutes(), clock.getUTCSeconds(), clock.getUTCMilliseconds()).getTime();
  };
  const seconds = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const payrollDate = (value) => {
    // ISO payroll dates are calendar labels, not instants to shift into another zone.
    const iso = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value || "");
    if (iso) return iso[1];
    const ms = timestamp(value);
    return ms === null ? null : new Date(ms).toISOString().slice(0, 10);
  };
  function capture(url, text) {
    if (!active || !String(url).includes("/GetTimeCardData")) return;
    try {
      let d = typeof text === "string" ? JSON.parse(text) : text;
      if (d?.d !== undefined) d = typeof d.d === "string" ? JSON.parse(d.d) : d.d;
      const rows = d?.TimecardData?.TimeCardData;
      if (!Array.isArray(rows)) return;
      const entries = rows.map((x) => ({
        date: payrollDate(x.ApplyToDate),
        in: punchTimestamp(x.DateTimeIn),
        out: punchTimestamp(x.DateTimeOut),
        regular: seconds(x.RegDurationSecs),
        ot: seconds(x.OTDurationSecs),
        unpaid: seconds(x.UnpaidDurationSecs),
        nonwork: x.IsNonWork === true || x.IsNonWork === 1 || x.IsNonWork === "true",
        payType: String(x.PayTypeName || x.PayTyeName || ""),
      })).filter((row) => row.date !== null);
      if (rows.length && !entries.length) return;
      window.postMessage(
        { channel: CHANNEL, type: "capture", schemaVersion: 1, normalizationVersion: 2, source: "paychex", entries, at: Date.now() },
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
          (this.responseType === "json" || this.responseType === "" || this.responseType === "text")
        )
          capture(this.__paychexHoursUrl, this.responseType === "json" ? this.response : this.responseText);
      };
      pending.set(this, handler);
      this.addEventListener("load", handler, { once: true });
    }
    return originalSend.apply(this, args);
  };
  XMLHttpRequest.prototype.send = wrappedSend;
})();
