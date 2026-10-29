// Capture only Paychex's own successful timecard responses; never initiate a Paychex request.
(() => {
  if (window.__paychexHoursBridgeV2) return;
  window.__paychexHoursBridgeV2 = true;
  const CHANNEL = "paychex-hours-capture-v2";
  function capture(url, text) {
    if (!String(url).includes("/GetTimeCardData")) return;
    try {
      const d = JSON.parse(text);
      const rows = d?.TimecardData?.TimeCardData;
      if (!Array.isArray(rows)) return;
      const entries = rows.map((x) => ({
        date: x.ApplyToDate,
        in: x.DateTimeIn,
        out: x.DateTimeOut,
        regular: x.RegDurationSecs,
        ot: x.OTDurationSecs,
        unpaid: x.UnpaidDurationSecs,
        nonwork: x.IsNonWork,
        payType: x.PayTyeName,
      }));
      window.postMessage(
        { channel: CHANNEL, type: "capture", entries, at: Date.now() },
        location.origin,
      );
    } catch {}
  }
  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    const p = nativeFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      p.then((r) => {
        if (r.ok && String(url).includes("GetTimeCardData"))
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
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__paychexHoursUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__paychexHoursUrl?.includes("GetTimeCardData"))
      this.addEventListener("load", function () {
        if (
          this.status >= 200 &&
          this.status < 300 &&
          typeof this.responseText === "string"
        )
          capture(this.__paychexHoursUrl, this.responseText);
      });
    return originalSend.apply(this, args);
  };
})();
