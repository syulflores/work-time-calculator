const $ = (id) => document.getElementById(id);
const msDate = (s) => {
  const m = /\/Date\((-?\d+)/.exec(s || "");
  return m ? Number(m[1]) : null;
};
const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayFromMs = (ms) => new Date(ms).toISOString().slice(0, 10); // Paychex ApplyToDate is a date-only midnight UTC value.
const fmt = (secs) =>
  `${Math.floor(Math.max(0, secs) / 3600)}h ${String(Math.floor((Math.max(0, secs) % 3600) / 60)).padStart(2, "0")}m`;
const dateTime = (ms) =>
  new Date(ms).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
// Register future modes with their own refresh handler here.
const modes = {
  manual: { label: "Manual", refresh: refreshManual },
  paychex: { label: "Paychex", refresh: refreshPaychex },
};
let data = null;
let refreshId = 0;
const isManual = () => $("mode").value === "manual";
const isDaily = () => $("periodMode").value === "day";
const periodValues = {
  week: { target: "40", manualHours: "0" },
  day: { target: "8", manualHours: "0" },
};

function updatePeriodSettings() {
  const values = periodValues[$("periodMode").value];
  $("targetLabel").textContent = isDaily() ? "Daily target (hours)" : "Weekly target (hours)";
  $("weekStartSetting").hidden = isDaily();
  $("target").max = isDaily() ? "24" : "168";
  for (const key of ["target", "manualHours"]) $(key).value = values[key];
}

function refreshManual() {
  data = { entries: [] };
  $("status").textContent = "Manual mode: enter your recorded hours and today's clock-in.";
  calculate();
}

function refresh() {
  refreshId++;
  data = null;
  $("refresh").disabled = false;
  $("manualSettings").hidden = !isManual();
  $("refresh").textContent = isManual() ? "Recalculate" : "Refresh from Paychex";
  $("foot").textContent = isManual()
    ? "The estimate is not an official payroll total. This extension does not clock you in or out."
    : "Read-only. The estimate is not an official payroll total. Keep Paychex open and signed in. This extension does not clock you in or out.";
  for (const id of ["worked", "remaining", "out"]) $(id).textContent = "?";
  $("period").textContent = "";
  $("detail").textContent = "";
  return modes[$("mode").value].refresh();
}
const clockMinutes = (s) => {
  if (!/^\d{2}:\d{2}$/.test(s || "")) return null;
  const [h, m] = s.split(":").map(Number);
  return h < 24 && m < 60 ? h * 60 + m : null;
};

function calculate() {
  if (!data) return;
  const now = new Date(),
    startDay = Number($("start").value),
    begin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!isDaily()) begin.setDate(begin.getDate() - ((begin.getDay() - startDay + 7) % 7));
  const end = new Date(begin);
  end.setDate(end.getDate() + (isDaily() ? 1 : 7));
  const first = localDay(begin),
    last = localDay(new Date(end.getTime() - 86400000));
  const entries = data.entries.filter((x) => {
    const m = msDate(x.date);
    if (m === null) return false;
    const day = dayFromMs(m);
    return day >= first && day <= last && !x.nonwork;
  });
  // One top-level timecard group is counted once; never also add TimeCardDetails.
  const seen = new Set();
  let recorded = isManual() ? Math.max(0, Number($("manualHours").value) || 0) * 3600 : 0,
    openEntries = 0;
  for (const x of entries) {
    const k = [x.date, x.in, x.out, x.regular, x.ot].join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    recorded +=
      Math.max(0, Number(x.regular) || 0) + Math.max(0, Number(x.ot) || 0);
    if (!x.out) openEntries++;
  }
  const target = Math.max(0, Number($("target").value) || (isDaily() ? 8 : 40)) * 3600;
  let remaining = Math.max(0, target - recorded);
  // We cannot safely infer an active clock-in from a transaction code alone.
  // Use the current date's open timecard row only if it has a clock-in and no clock-out.
  const open = entries
    .filter((x) => x.in && !x.out)
    .sort((a, b) => (msDate(b.in) || 0) - (msDate(a.in) || 0))[0];
  let live = 0,
    clockout = "Not currently detectable";
  let liveInfo = "";
  const manual = $("manualEnabled").checked
    ? clockMinutes($("manualIn").value)
    : null;
  const manualStart =
    manual === null
      ? null
      : new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          Math.floor(manual / 60),
          manual % 60,
        ).getTime();

  if (open || manualStart !== null) {
    const start = manualStart !== null ? manualStart : msDate(open.in);
    if (
      start !== null &&
      start <= Date.now() &&
      Date.now() - start < 24 * 3600000
    ) {
      live = Math.max(0, (Date.now() - start) / 1000);
      const currentAlreadyCounted =
        manualStart !== null &&
        entries.some((x) => msDate(x.in) === start && Number(x.regular) > 0);
      if (!currentAlreadyCounted) {
        remaining = Math.max(0, target - recorded - live);
      }
      clockout = dateTime(
        Date.now() +
          remaining * 1000 +
          Math.max(0, Number($("break").value) || 0) * 60000,
      );
      liveInfo =
        manualStart !== null
          ? "Using manually entered clock-in; assumes current shift is not already included in recorded paid time. "
          : "Active timecard detected; estimate assumes no other unpaid breaks. ";
    }
  }

  $("worked").textContent = fmt(recorded + live);
  $("remaining").textContent = fmt(remaining);
  $("out").textContent = clockout;
  $("period").textContent =
    `${isDaily() ? "Day: " + first : "Workweek: " + first + " through " + last} · ${isManual() ? "manual entry" : entries.length + " timecard rows"}`;
  $("detail").textContent =
    liveInfo +
    (open || manualStart !== null
      ? ""
      : "No open clock-in row returned. Enter today’s clock-in above and enable manual mode. ") +
    (data.warning || "") +
    (isManual() ? " Times are estimates; verify your payroll policies." : " Times are estimates; verify Paychex rounding and payroll policies.");
}

async function refreshPaychex() {
  const requestId = refreshId;
  const btn = $("refresh");
  btn.disabled = true;
  $("status").textContent = "Checking captured Paychex timecard…";
  try {
    const tabs = await chrome.tabs.query({
      url: "https://paychex.centralservers.com/*",
    });
    const tab = tabs.find((t) => t.active) || tabs[0];
    if (!tab) throw Error("Open paychex.centralservers.com and sign in first.");
    // Install hooks before Paychex makes its next timecard request.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["bridge.js"],
      world: "MAIN",
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["relay.js"],
      world: "ISOLATED",
    });
    let r = await chrome.tabs.sendMessage(tab.id, {
      type: "PAYCHEX_HOURS_READ",
    });
    if (!Array.isArray(r?.entries)) {
      const saved = await chrome.storage.local.get("capturedTimecard");
      r = saved.capturedTimecard;
    }
    if (!Array.isArray(r?.entries))
      throw Error(
        "No timecard captured. Leave Paychex open, reload its timecard page, and click Refresh again.",
      );
    if (requestId !== refreshId) return;
    data = r;
    data.warning =
      "Data captured from Paychex at " +
      new Date(r.at).toLocaleTimeString() +
      ". Reload the Paychex timecard to update.";
    $("status").textContent =
      `Loaded ${r.entries.length} records from Paychex.`;
    calculate();
  } catch (e) {
    if (requestId === refreshId) $("status").textContent = "Notice: " + e.message;
  } finally {
    if (requestId === refreshId) btn.disabled = false;
  }
}

(async () => {
  const saved = await chrome.storage.local.get([
    "mode",
    "periodMode",
    "dailyTarget",
    "dailyManualHours",
    "manualHours",
    "start",
    "target",
    "break",
    "manualIn",
    "manualEnabled",
  ]);
  for (const [value, mode] of Object.entries(modes)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = mode.label;
    $("mode").append(option);
  }
  $("mode").value = Object.hasOwn(modes, saved.mode) ? saved.mode : "manual";
  $("mode").addEventListener("change", () => {
    chrome.storage.local.set({ mode: $("mode").value });
    refresh();
  });
  periodValues.week.target = saved.target ?? "40";
  periodValues.week.manualHours = saved.manualHours ?? "0";
  periodValues.day.target = saved.dailyTarget ?? "8";
  periodValues.day.manualHours = saved.dailyManualHours ?? "0";
  $("periodMode").value = saved.periodMode === "day" ? "day" : "week";
  $("periodMode").addEventListener("change", () => {
    chrome.storage.local.set({ periodMode: $("periodMode").value });
    updatePeriodSettings();
    calculate();
  });
  for (const key of ["start", "target", "break", "manualHours"])
    if (saved[key] != null) $(key).value = saved[key];
  updatePeriodSettings();
  for (const key of ["start", "target", "break", "manualHours"])
    $(key).addEventListener("change", () => {
      const periodSpecific = key === "target" || key === "manualHours";
      if (periodSpecific) periodValues[$("periodMode").value][key] = $(key).value;
      const storageKey = periodSpecific && isDaily()
        ? (key === "target" ? "dailyTarget" : "dailyManualHours")
        : key;
      chrome.storage.local.set({ [storageKey]: $(key).value });
      calculate();
    });
  if (saved.manualIn) $("manualIn").value = saved.manualIn;
  $("manualEnabled").checked = !!saved.manualEnabled;
  for (const key of ["manualIn", "manualEnabled"])
    $(key).addEventListener("change", () => {
      chrome.storage.local.set({
        [key]: key === "manualEnabled" ? $(key).checked : $(key).value,
      });
      calculate();
    });
  $("refresh").addEventListener("click", refresh);
  refresh();
  setInterval(calculate, 30000);
})();
