const $ = (id) => document.getElementById(id);
const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const unitSeconds = () => $("timeUnit").value === "hours" ? 3600 : 60;
const displayNumber = (value) => Number(Number(value).toFixed(10));
const fmt = (secs) => `${Number((Math.max(0, secs) / unitSeconds()).toFixed(2))} ${$("timeUnit").value === "hours" ? "hours" : "minutes"}`;
const dateTime = (ms) =>
  new Date(ms).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
// Register future modes with their own refresh handler here.
const modes = {
  manual: { label: "Manual", refresh: refreshManual },
  paychex: { label: "Paychex", refresh: refreshPaychex, url: "https://paychex.centralservers.com/*", bridge: "bridge-paychex.js" },
};
let data = null;
let refreshId = 0;
let integrationQueue = Promise.resolve();
const isManual = () => $("mode").value === "manual";
const isDaily = () => $("periodMode").value === "day";
const unpaidValues = { manual: "0", paychex: "0" };
// Saved unpaid values remain minutes, regardless of the displayed unit.
const unpaidMinutes = () => Math.max(0, Number($("break").value) || 0) *
  ($("timeUnit").value === "hours" ? 60 : 1);
function updateUnpaidInput() {
  const hours = $("timeUnit").value === "hours";
  const unit = hours ? "hours" : "minutes";
  $("breakLabel").textContent = `Total unpaid time today (${unit})`;
  $("unpaidOverride").hidden = isManual();
  $("break").disabled = !isManual() && !$("unpaidOverride").checked;
  $("break").max = hours ? "8" : "480";
  $("break").value = Number((Number(unpaidValues[$("mode").value]) / (hours ? 60 : 1)).toFixed(10));
}
const periodValues = {
  week: { target: "40", manualHours: "0" },
  day: { target: "8", manualHours: "0" },
};

function updatePeriodSettings() {
  const values = periodValues[$("periodMode").value];

  $("manualSettings").hidden = !isManual() || isDaily();

  $("manualHours").value = displayNumber(Number(values.manualHours) * 3600 / unitSeconds());
}

function refreshManual() {
  data = { entries: [] };
  $("status").textContent = "Manual mode: enter your first clock-in, target, and total unpaid time today.";
  calculate();
}

function refresh() {
  refreshId++;
  data = null;
  $("refresh").disabled = false;
  $("manualSettings").hidden = !isManual() || isDaily();
  updateUnpaidInput();
  $("manualEnabled").hidden = isManual();
  $("manualIn").required = isManual();
  $("refresh").textContent = isManual() ? "Recalculate" : "Refresh from Paychex";
  $("foot").textContent = isManual()
    ? "The estimate is not an official payroll total. This extension does not clock you in or out."
    : "Read-only. The estimate is not an official payroll total. Keep Paychex open and signed in. This extension does not clock you in or out.";
  for (const id of ["worked", "remaining", "out"]) $(id).textContent = "?";
  $("period").textContent = "";
  $("detail").textContent = "";
  const requestId = refreshId;
  const mode = $("mode").value;
  integrationQueue = integrationQueue.catch(() => {}).then(async () => {
    if (requestId !== refreshId) return;
    try {
      await configureCapture(mode);
      await stopIntegrations();
      if (requestId !== refreshId) return;
      await modes[mode].refresh();
    } catch (error) {
      if (requestId === refreshId) $("status").textContent = "Notice: " + error.message;
    }
  });
  return integrationQueue;
}
// Capture at document_start so a full page reload does not lose the timecard response.
async function configureCapture(mode) {
  const ids = ["work-time-paychex-relay", "work-time-paychex-bridge"];
  const installed = await chrome.scripting.getRegisteredContentScripts({ ids });
  if (mode !== "paychex") {
    if (installed.length) await chrome.scripting.unregisterContentScripts({ ids: installed.map((script) => script.id) });
    return;
  }
  const scripts = [
    { id: ids[0], js: ["relay.js"], world: "ISOLATED" },
    { id: ids[1], js: ["bridge-paychex.js"], world: "MAIN" },
  ].filter((script) => !installed.some((current) => current.id === script.id));
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts.map((script) => ({
    ...script, matches: [modes.paychex.url], runAt: "document_start", persistAcrossSessions: true,
  })));
}

// Stop installed integrations across all registered provider tabs before starting one.
async function stopIntegrations() {
  const urls = Object.values(modes).map((mode) => mode.url).filter(Boolean);
  const tabs = urls.length ? await chrome.tabs.query({ url: urls }) : [];
  await Promise.all(tabs.map(async (tab) => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "ISOLATED",
        func: () => window.__workTimeRelayV1?.stop(),
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: () => window.__workTimeBridge?.stop(),
      });
    } catch (error) {
      // A closed or navigated tab no longer has a running integration.
      const current = await chrome.tabs.get(tab.id).catch(() => null);
      if (current && urls.some((url) => current.url?.startsWith(url.slice(0, -1)))) throw error;
    }
  }));
}

const clockMinutes = (s) => {
  if (!/^\d{2}:\d{2}$/.test(s || "")) return null;
  const [h, m] = s.split(":").map(Number);
  return h < 24 && m < 60 ? h * 60 + m : null;
};

// Both modes supply inputs to the same clock-out equation.
function shiftEstimate(start, target, unpaid, now) {
  const out = start + (target + unpaid) * 1000;
  return { out, remaining: Math.max(0, (out - now) / 1000) };
}

function calculate() {
  if (!data) return;
  const now = new Date(), nowMs = now.getTime(), today = localDay(now);
  const begin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!isDaily()) begin.setDate(begin.getDate() - ((begin.getDay() - Number($("start").value) + 7) % 7));
  const end = new Date(begin);
  end.setDate(end.getDate() + (isDaily() ? 1 : 7));
  const lastDay = new Date(end);
  lastDay.setDate(lastDay.getDate() - 1);
  const first = localDay(begin), last = localDay(lastDay);
  const inputs = data.inputs;
  if (!isManual() && (!inputs || inputs.today !== today || inputs.first !== first || inputs.last !== last)) {
    refresh();
    return;
  }
  const target = Math.max(0, Number(periodValues[$("periodMode").value].target) || 0) * 3600;
  const previous = isDaily() ? 0 : isManual()
    ? Math.max(0, Number($("manualHours").value) || 0) * unitSeconds()
    : inputs.previousPaid;
  const todayTarget = Math.max(0, target - previous);
  const takenUnpaid = isManual() ? 0 : inputs.totalUnpaid;
  const enteredUnpaid = unpaidMinutes() * 60;
  const totalUnpaid = isManual() || $("unpaidOverride").checked ? enteredUnpaid : takenUnpaid;
  if (!isManual() && !$("unpaidOverride").checked) {
    $("break").value = displayNumber(takenUnpaid / unitSeconds());
  }
  const manual = isManual() || $("manualEnabled").checked ? clockMinutes($("manualIn").value) : null;
  const manualStart = manual === null ? null : new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(manual / 60), manual % 60).getTime();
  const start = manualStart ?? (isManual() ? null : inputs.firstClockIn);
  const validStart = start !== null && start <= nowMs;
  const estimate = validStart ? shiftEstimate(start, todayTarget, totalUnpaid, nowMs) : null;
  $("worked").textContent = fmt(todayTarget);
  $("remaining").textContent = estimate ? fmt(estimate.remaining) : "?";
  $("out").textContent = estimate ? dateTime(estimate.out) : "Enter today's clock-in";
  $("period").textContent = isDaily() ? "Day: " + today : "Workweek: " + first + " through " + last;
  $("detail").textContent =
    (isDaily() ? "" : "Earlier paid time: " + fmt(previous) + ". ") +
    (isManual() ? "Include all unpaid breaks for today, taken or planned. " :
      "Received unpaid time: " + fmt(takenUnpaid) + ". " +
      ($("unpaidOverride").checked ? "Using your total unpaid time override. " : "Check the box to override. ")) +
    (start !== null && !validStart ? "Clock-in must not be in the future. " : "") +
    (data.warning || "");
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
    if (requestId !== refreshId) return;
    const tab = tabs.find((t) => t.active) || tabs[0];
    if (!tab) throw Error("Open paychex.centralservers.com and sign in first.");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "ISOLATED",
      func: (source) => { window.__workTimeSource = source; }, args: ["paychex"],
    });
    if (requestId !== refreshId) return;
    // Install the receiver before the bridge can emit a capture.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["relay.js"],
      world: "ISOLATED",
    });
    if (requestId !== refreshId) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [modes.paychex.bridge],
      world: "MAIN",
    });
    if (requestId !== refreshId) return;
    const now = new Date();
    const begin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!isDaily()) begin.setDate(begin.getDate() - ((begin.getDay() - Number($("start").value) + 7) % 7));
    const last = new Date(begin);
    last.setDate(last.getDate() + (isDaily() ? 0 : 6));
    let r = await chrome.tabs.sendMessage(tab.id, {
      type: "WORK_TIME_READ",
      periodMode: $("periodMode").value,
      today: localDay(now), first: localDay(begin), last: localDay(last), now: now.getTime(),
      source: "paychex",
    });
    if (r?.error) throw Error(r.error);
    if (!Array.isArray(r?.entries) || r.source !== "paychex" || !r.inputs)
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
      `Loaded ${isDaily() ? r.inputs.todayRecords : r.entries.length} records from Paychex.${r.inputs.todayRecords ? "" : " No records for today; open today's timecard in Paychex and refresh."}`;
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
    "breakUnit",
    "timeUnit",
    "manualTotalUnpaid",
    "paychexAdditionalUnpaid",
    "manualIn",
    "manualEnabled",
    "unpaidOverride",
    "paychexUnpaidOverride",
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
  if (saved.start != null) $("start").value = saved.start;
  unpaidValues.manual = saved.manualTotalUnpaid ?? "0";
  unpaidValues.paychex = saved.paychexUnpaidOverride ?? "0";
  $("unpaidOverride").checked = !!saved.unpaidOverride;
  $("timeUnit").value = (saved.timeUnit ?? saved.breakUnit) === "hours" ? "hours" : "minutes";
  function updateTimeInputs() {
    const unit = $("timeUnit").value;
    for (const [period, id, max] of [["week", "weeklyTarget", 168], ["day", "dailyTarget", 24]]) {
      $(id).value = displayNumber(Number(periodValues[period].target) * 3600 / unitSeconds());
      $(id).max = max * 3600 / unitSeconds();
      $(id + "Label").textContent = (period === "week" ? "Weekly" : "Daily") + " target (" + unit + ")";
    }
    $("manualHoursLabel").textContent = "Paid time before today (" + unit + ")";
    updatePeriodSettings();
    updateUnpaidInput();
  }
  $("timeUnit").addEventListener("change", () => {
    updateTimeInputs();
    chrome.storage.local.set({ timeUnit: $("timeUnit").value });
    calculate();
  });
  for (const [period, id, storageKey] of [["week", "weeklyTarget", "target"], ["day", "dailyTarget", "dailyTarget"]]) {
    $(id).addEventListener("change", () => {
      periodValues[period].target = Math.max(0, Number($(id).value) || 0) * unitSeconds() / 3600;
      chrome.storage.local.set({ [storageKey]: periodValues[period].target });
      calculate();
    });
  }
  updateTimeInputs();
  for (const key of ["start", "break", "manualHours"])
    $(key).addEventListener("change", () => {
      let value = $(key).value;
      let storageKey = key;
      if (key === "manualHours") {
        value = Math.max(0, Number(value) || 0) * unitSeconds() / 3600;
        periodValues[$("periodMode").value].manualHours = value;
        storageKey = isDaily() ? "dailyManualHours" : "manualHours";
      }
      if (key === "break") {
        value = unpaidMinutes();
        unpaidValues[$("mode").value] = value;
        storageKey = isManual() ? "manualTotalUnpaid" : "paychexUnpaidOverride";
      }
      chrome.storage.local.set({ [storageKey]: value });
      calculate();
    });
  function showSettings(show) {
    $("calculatorPage").hidden = show;
    $("settingsPage").hidden = !show;
    $("openSettings").hidden = show;
    $("closeSettings").hidden = !show;
    $("openSettings").setAttribute("aria-expanded", String(show));
    $("pageTitle").textContent = show ? "Settings" : "Work Time Left";
    (show ? $("closeSettings") : $("openSettings")).focus();
  }
  $("openSettings").addEventListener("click", () => showSettings(true));
  $("closeSettings").addEventListener("click", () => showSettings(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("settingsPage").hidden) showSettings(false);
  });
  $("unpaidOverride").addEventListener("change", () => {
    chrome.storage.local.set({ unpaidOverride: $("unpaidOverride").checked });
    updateUnpaidInput();
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
