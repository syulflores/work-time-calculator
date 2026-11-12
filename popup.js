const $ = (id) => document.getElementById(id);
const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const unitSeconds = () => $("timeUnit").value === "hours" ? 3600 : 60;
const displayNumber = (value) => Number(Number(value).toFixed(10));
const hoursMinutes = () => $("timeUnit").value === "hoursMinutes";
const unitLabel = () => hoursMinutes() ? "HH:MM" : $("timeUnit").value === "hours" ? "Hrs" : "Min";
const durationValue = (secs) => {
  if (!hoursMinutes()) return displayNumber(secs / unitSeconds());
  const minutes = Math.round(Math.max(0, secs) / 60);
  return Math.floor(minutes / 60) + ":" + String(minutes % 60).padStart(2, "0");
};
const durationSeconds = (value) => {
  if (!hoursMinutes()) return Math.max(0, Number(value) || 0) * unitSeconds();
  const match = /^(\d+):([0-5]\d)$/.exec(String(value).trim());
  return match ? (Number(match[1]) * 60 + Number(match[2])) * 60 : 0;
};
function configureDurationInput(input) {
  input.type = hoursMinutes() ? "text" : "number";
  if (hoursMinutes()) {
    input.placeholder = "HH:MM";
    input.pattern = "[0-9]+:[0-5][0-9]";
  } else {
    input.removeAttribute("placeholder");
    input.removeAttribute("pattern");
  }
}
const fmt = (secs) => `${hoursMinutes() ? durationValue(secs) : Number((Math.max(0, secs) / unitSeconds()).toFixed(2))} ${unitLabel()}`;
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
function setStatus(message, error = false) {
  $("status").textContent = message;
  $("status").dataset.state = error ? "error" : "ok";
}
const unpaidValues = { manual: "0", paychex: "0" };
const gatheredClockIn = () => !isManual() && Number.isFinite(data?.inputs?.firstClockIn) &&
  Math.abs(data.inputs.firstClockIn) <= 8640000000000000 ? data.inputs.firstClockIn : null;
const gatheredUnpaid = () => !isManual() && data?.inputs?.todayRecords > 0 &&
  Number.isFinite(data.inputs.totalUnpaid) && data.inputs.totalUnpaid >= 0 ? data.inputs.totalUnpaid : null;
const useClockInput = () => $("manualEnabled").checked || gatheredClockIn() === null;
const useUnpaidInput = () => $("unpaidOverride").checked || gatheredUnpaid() === null;
// Saved unpaid values remain minutes, regardless of the displayed unit.
const unpaidMinutes = () => durationSeconds($("break").value) / 60;
function updateUnpaidInput(restoreValue = true) {
  const hours = $("timeUnit").value === "hours";
  configureDurationInput($("break"));
  $("breakLabel").textContent = `Unpaid time (${unitLabel()})`;
  $("unpaidOverrideLabel").hidden = isManual();
  $("break").hidden = !useUnpaidInput();
  $("break").disabled = false;
  $("providerUnpaid").hidden = useUnpaidInput();
  $("providerUnpaid").textContent = gatheredUnpaid() === null ? "?" : fmt(gatheredUnpaid());
  $("break").max = hours ? "8" : "480";
  if (restoreValue) {
    $("break").value = durationValue(Number(unpaidValues[$("mode").value]) * 60);
  }
}
const periodValues = {
  week: { target: "40" },
  day: { target: "8" },
};

function refreshManual() {
  data = { entries: [] };
  setStatus(isDaily()
    ? "Enter your first clock-in, target, and total unpaid time today."
    : "Enter your clock-in, paid targets, and total unpaid time for the week.");
  calculate();
}

function updateClockInput() {
  const manual = useClockInput();
  $("clockOverrideLabel").hidden = isManual();
  $("manualIn").hidden = !manual;
  $("manualIn").required = manual;
  $("providerClockIn").hidden = manual;
  $("providerClockIn").textContent = gatheredClockIn() === null ? "?"
    : new Date(gatheredClockIn()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function refresh(requestAccess = false) {
  const mode = $("mode").value;
  // Request immediately from the click/change handler to preserve the user gesture.
  const access = mode === "manual" ? Promise.resolve(true)
    : (requestAccess
      ? chrome.permissions.request({ origins: [modes[mode].url] })
      : chrome.permissions.contains({ origins: [modes[mode].url] }))
      .catch((error) => ({ error }));
  refreshId++;
  $("modeSubtitle").textContent = `Mode: ${modes[$("mode").value].label}`;
  $("clockProviderHelp").hidden = isManual();
  $("unpaidProviderHelp").hidden = isManual();
  setStatus(isManual() ? "Recalculating..." : "Refreshing...");
  data = null;
  $("refresh").disabled = false;
  updateUnpaidInput();
  updateClockInput();
  $("providerClockIn").textContent = "?";
  $("refresh").textContent = isManual() ? "Recalculate" : "Refresh from Paychex";
  $("foot").textContent = isManual()
    ? "The estimate is not an official payroll total. This extension does not clock you in or out."
    : "Read-only. The estimate is not an official payroll total. Keep Paychex open and signed in. This extension does not clock you in or out.";
  for (const id of ["worked", "remaining", "out"]) $(id).textContent = "?";
  $("period").textContent = "";
  $("detail").textContent = "";
  calculate();
  const requestId = refreshId;
  integrationQueue = integrationQueue.catch(() => {}).then(async () => {
    if (requestId !== refreshId) return;
    try {
      if (mode === "paychex") {
        const tabs = await chrome.tabs.query({ url: modes[mode].url });
        if (requestId !== refreshId) return;
        if (!tabs.length) {
          setStatus("Open Paychex, sign in, and open your timecard, then click Refresh from Paychex.", true);
          return;
        }
      }
      const granted = await access;
      if (granted?.error) throw granted.error;
      if (!granted) {
        if (requestId === refreshId) setStatus("Paychex site access is required. Click Refresh from Paychex and allow access. If access stays blocked, enable it in Chrome's extension settings under Site access.", true);
        return;
      }
      if (requestId !== refreshId) return;
      if (mode === "manual") {
        // Cleanup must not block manual calculations.
        await configureCapture(mode).catch(() => {});
      } else {
        await configureCapture(mode);
      }
      // A stale or inaccessible tab must not block reading another provider tab.
      await stopIntegrations().catch(() => {});
      if (requestId !== refreshId) return;
      await modes[mode].refresh();
    } catch (error) {
      if (requestId === refreshId) setStatus("Notice: " + error.message, true);
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

// Break timing is unavailable: subtract the entered total from elapsed shift time.
function remainingPaid(start, paid, unpaid, now) {
  const worked = Math.max(0, (now - start) / 1000 - unpaid);
  return Math.max(0, paid - worked);
}
const countdownSeconds = (estimate) => $("countdownMode").value === "elapsed" ? estimate.remaining : estimate.workingRemaining;

// Both modes supply inputs to the same clock-out equation.
function shiftEstimate(start, target, unpaid, now) {
  const out = start + (target + unpaid) * 1000;
  return { out, remaining: Math.max(0, (out - now) / 1000), workingRemaining: remainingPaid(start, target, unpaid, now) };
}

// Allocate remaining paid time to scheduled days rather than one continuous shift.
function weeklyEstimate(start, target, unpaid, now, dailyTarget, dates, dayPlan) {
  let left = target;
  const today = localDay(new Date(start));
  let lastOut = null;
  let workingRemaining = 0;
  for (const date of dates) {
    const key = localDay(date);
    if (key < today) continue;
    const plan = dayPlan(key);
    const explicitStart = plan.clock !== null;
    const dayTarget = plan.paidTarget ?? dailyTarget;
    if (dayTarget <= 0) continue;
    if (key !== today && !explicitStart && plan.paidTarget == null && (date.getDay() === 0 || date.getDay() === 6)) continue;
    const clock = key === today ? new Date(start) : new Date(date);
    if (key !== today) {
      const fallback = new Date(start);
      const minutes = explicitStart ? plan.clock : fallback.getHours() * 60 + fallback.getMinutes();
      clock.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    }
    const paid = Math.min(left, dayTarget);
    const dayUnpaid = key === today ? unpaid : plan.unpaid ?? unpaid;
    workingRemaining += remainingPaid(clock.getTime(), paid, dayUnpaid, now);
    lastOut = clock.getTime() + (paid + dayUnpaid) * 1000;
    left -= paid;
    if (left <= 0) return { out: lastOut, remaining: Math.max(0, (lastOut - now) / 1000), workingRemaining };
  }
  return null;
}

let weeklyValues = {};
function weekDates() {
  const first = new Date();
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() - ((first.getDay() - Number($("start").value) + 7) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(first); date.setDate(date.getDate() + i); return date;
  });
}
function weeklyField(date, field) {
  const saved = weeklyValues[$("mode").value]?.[date] || {};
  const gathered = isManual() ? null : data?.inputs?.days?.[date]?.[field];
  const manual = isManual() || saved[field + "Override"] === true || !Number.isFinite(gathered);
  return { saved, manual, value: manual ? saved[field] ?? (field === "totalUnpaid" ? 0 : "") : gathered };
}
function weeklyPaidTarget(date) {
  const key = localDay(date);
  const values = weeklyValues[$("mode").value]?.[key] || {};
  const recorded = !isManual() && key < localDay(new Date()) && data?.inputs
    ? data.inputs.days?.[key]?.paidSeconds ?? 0 : null;
  if (recorded !== null && values.paidTargetOverride !== true) return recorded;
  const saved = values.paidTarget;
  if (Number.isFinite(saved) && saved >= 0) return saved;
  if (recorded !== null) return recorded;
  return date.getDay() === 0 || date.getDay() === 6 ? 0 : Math.max(0, Number(periodValues.day.target) || 0) * 3600;
}
function weeklyPreviousPaid(dates, today) {
  return dates.filter((date) => localDay(date) < today)
    .reduce((total, date) => total + weeklyPaidTarget(date), 0);
}
function renderWeek() {
  $("dailyInputs").hidden = !isDaily();
  $("weeklyInputs").hidden = isDaily();
  document.documentElement.classList.toggle("weekly", !isDaily());
  if (isDaily()) return;
  const dates = weekDates(), table = $("weekTable");
  table.replaceChildren();
  const header = table.createTHead().insertRow();
  const corner = document.createElement("th"); corner.textContent = "Day"; header.append(corner);
  for (const date of dates) {
    const th = document.createElement("th"); th.scope = "col";
    th.textContent = date.toLocaleDateString([], { weekday: "short" });
    const small = document.createElement("small");
    small.textContent = date.toLocaleDateString([], { month: "numeric", day: "numeric" }); th.append(small);
    if (localDay(date) === localDay(new Date())) th.className = "today";
    header.append(th);
  }
  const body = table.createTBody();
  for (const [field, label] of [["firstClockIn", "Clock-in"], ["totalUnpaid", "Unpaid"], ["paidTarget", isManual() ? "Paid target" : "Paid time / target"]]) {
    const row = body.insertRow(), heading = document.createElement("th"); heading.scope = "row";
    heading.textContent = label + (field === "firstClockIn" ? "" : ` (${unitLabel()})`); row.append(heading);
    for (const date of dates) {
      const key = localDay(date), state = weeklyField(key, field), cell = row.insertCell();
      const wrap = document.createElement("div"); wrap.className = "week-value";
      const name = `${date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })} ${label}`;
      const save = (property, value) => {
        const mode = $("mode").value;
        weeklyValues[mode] ??= {}; weeklyValues[mode][key] ??= {};
        weeklyValues[mode][key][property] = value;
        chrome.storage.local.set({ weeklyValues }); calculate();
      };
      if (field === "paidTarget") {
        if (!isManual()) {
          const check = document.createElement("input"); check.type = "checkbox";
          check.checked = state.saved.paidTargetOverride === true;
          check.title = "Manual override"; check.setAttribute("aria-label", `Manual override: ${name}`);
          check.addEventListener("change", () => save("paidTargetOverride", check.checked)); wrap.append(check);
          if (!check.checked) {
            const value = document.createElement("span"); value.textContent = fmt(weeklyPaidTarget(date));
            wrap.append(value); cell.append(wrap); continue;
          }
        }
        const input = document.createElement("input");
        configureDurationInput(input); input.min = "0"; input.step = "any";
        input.setAttribute("aria-label", field === "firstClockIn" ? name : `${name} (${unitLabel()})`);
        input.value = durationValue(weeklyPaidTarget(date));
        input.title = "Planned paid time. Set 0 for a day off; clear to use the default.";
        input.addEventListener("change", () => {
          if (!input.reportValidity()) return;
          save(field, input.value === "" ? null : durationSeconds(input.value));
        });
        wrap.append(input); cell.append(wrap); continue;
      }
      if (!isManual()) {
        const check = document.createElement("input"); check.type = "checkbox";
        check.checked = state.saved[field + "Override"] === true;
        check.title = "Manual override"; check.setAttribute("aria-label", `Manual override: ${name}`);
        check.addEventListener("change", () => save(field + "Override", check.checked)); wrap.append(check);
      }
      if (state.manual) {
        const input = document.createElement("input"); input.type = field === "firstClockIn" ? "time" : "number";
        input.setAttribute("aria-label", field === "firstClockIn" ? name : `${name} (${unitLabel()})`);
        if (field === "totalUnpaid") { configureDurationInput(input); input.min = "0"; input.step = "any"; }
        input.value = field === "totalUnpaid" ? durationValue(Number(state.value) * 60) : state.value;
        input.addEventListener("change", () => {
          if (!input.reportValidity()) return;
          save(field, field === "totalUnpaid" ? durationSeconds(input.value) / 60 : input.value);
        }); wrap.append(input);
      } else {
        const value = document.createElement("span");
        value.textContent = field === "firstClockIn" ? new Date(state.value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : fmt(state.value); wrap.append(value);
      }
      cell.append(wrap);
    }
  }
  $("weekHelp").textContent = "Projection uses each remaining day's paid target. Set 0 for a day off; clear to restore the default. " + (isManual()
    ? "Past paid targets count as completed paid time. "
    : "Completed days show recorded regular and overtime hours; today and future days show planned targets. Check a paid-hours field to override it. ") + "Blank future days use today's clock-in and unpaid time; enter planned values to change them." + (isManual() ? "" : " Check a field to override it; enter missing values directly.");
}

function calculate() {
  updateClockInput();
  updateUnpaidInput(false);
  const now = new Date(), nowMs = now.getTime(), today = localDay(now);
  const begin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!isDaily()) begin.setDate(begin.getDate() - ((begin.getDay() - Number($("start").value) + 7) % 7));
  const end = new Date(begin);
  end.setDate(end.getDate() + (isDaily() ? 1 : 7));
  const lastDay = new Date(end);
  lastDay.setDate(lastDay.getDate() - 1);
  const first = localDay(begin), last = localDay(lastDay);
  const inputs = data?.inputs;
  if (!isManual() && inputs && (inputs.today !== today || inputs.first !== first || inputs.last !== last)) {
    refresh();
    return;
  }
  const target = Math.max(0, Number(periodValues[$("periodMode").value].target) || 0) * 3600;
  const previous = isDaily() ? 0 : weeklyPreviousPaid(weekDates(), today);
  const todayTarget = Math.max(0, target - previous);
  renderWeek();
  const weekClock = weeklyField(today, "firstClockIn"), weekUnpaid = weeklyField(today, "totalUnpaid");
  const takenUnpaid = gatheredUnpaid();
  const enteredUnpaid = unpaidMinutes() * 60;
  const totalUnpaid = !isDaily() ? Number(weekUnpaid.value) * (weekUnpaid.manual ? 60 : 1) : useUnpaidInput() ? enteredUnpaid : takenUnpaid;
  const manual = !isDaily() ? (weekClock.manual ? clockMinutes(weekClock.value) : null) : useClockInput() ? clockMinutes($("manualIn").value) : null;
  const manualStart = manual === null ? null : new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(manual / 60), manual % 60).getTime();
  const start = !isDaily() ? (weekClock.manual ? manualStart : weekClock.value) : useClockInput() ? manualStart : gatheredClockIn();
  const validStart = start !== null && start <= nowMs;
  const dailyTarget = Math.max(0, Number(periodValues.day.target) || 0) * 3600;
  const estimate = !validStart ? null : isDaily()
    ? shiftEstimate(start, todayTarget, totalUnpaid, nowMs)
    : weeklyEstimate(start, todayTarget, totalUnpaid, nowMs, dailyTarget, weekDates(), (date) => {
      const clock = weeklyField(date, "firstClockIn"), unpaid = weeklyField(date, "totalUnpaid");
      const hasUnpaid = !unpaid.manual || Object.hasOwn(unpaid.saved, "totalUnpaid");
      return {
        clock: clock.manual ? clockMinutes(clock.value) : new Date(clock.value).getHours() * 60 + new Date(clock.value).getMinutes(),
        paidTarget: weeklyPaidTarget(new Date(date + "T00:00:00")),
        unpaid: hasUnpaid ? Number(unpaid.value) * (unpaid.manual ? 60 : 1) : null,
      };
    });
  $("worked").textContent = fmt(todayTarget);
  $("remainingLabel").textContent = $("countdownMode").value === "elapsed"
    ? "Time until projected clock-out" : "Working time until projected clock-out";
  $("remaining").textContent = estimate ? fmt(countdownSeconds(estimate)) : "?";
  $("out").textContent = estimate ? dateTime(estimate.out) : validStart && !isDaily() ? "Target exceeds this week's planned hours" : "Enter today's clock-in";
  $("period").textContent = isDaily() ? "" : "Workweek: " + first + " through " + last;
  $("detail").textContent =
    (isDaily() ? "" : "Earlier paid time: " + fmt(previous) + ". ") +
    (isManual() ? "Include all unpaid breaks for today, taken or planned. " :
      (takenUnpaid === null ? "Unpaid time unavailable. Using your entered total. " : "")) +
    (start !== null && !validStart ? "Clock-in must not be in the future. " : "") +
    (data?.warning || "");
}

async function refreshPaychex() {
  const requestId = refreshId;
  const btn = $("refresh");
  btn.disabled = true;
  setStatus("Checking captured Paychex timecard…");
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
    }).catch((error) => {
      if (/receiving end does not exist|could not establish connection/i.test(error.message)) {
        throw Error("Open your Paychex timecard or reload it, then click Refresh from Paychex.");
      }
      throw error;
    });
    if (r?.error) throw Error(r.error);
    if (!Array.isArray(r?.entries) || r.source !== "paychex" || !r.inputs)
      throw Error(
        "No timecard captured. Leave Paychex open, reload its timecard page, and click Refresh again.",
      );
    if (requestId !== refreshId) return;
    data = r;
    data.warning =
      "Data captured from Paychex on " +
      new Date(r.at).toLocaleString([], {
        weekday: "short", year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", second: "2-digit",
      }) +
      ". Reload the Paychex timecard to update.";
    setStatus(
      `Loaded ${isDaily() ? r.inputs.todayRecords : r.entries.length} records from Paychex.${r.inputs.todayRecords ? "" : " No records for today; open today's timecard in Paychex and refresh."}`,
      !r.inputs.todayRecords,
    );
    calculate();
  } catch (e) {
    if (requestId === refreshId) setStatus("Notice: " + e.message, true);
  } finally {
    if (requestId === refreshId) btn.disabled = false;
  }
}

(async () => {
  const saved = await chrome.storage.local.get([
    "countdownMode",
    "weeklyValues",
    "darkMode",
    "mode",
    "periodMode",
    "dailyTarget",
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
  function applyTheme(dark) {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    $("darkMode").checked = dark;
    try {
      localStorage.setItem("darkMode", String(dark));
    } catch {
      // Saving in chrome.storage still works without the optional paint cache.
    }
  }
  $("countdownMode").value = saved.countdownMode === "elapsed" ? "elapsed" : "working";
  $("countdownMode").addEventListener("change", () => {
    chrome.storage.local.set({ countdownMode: $("countdownMode").value });
    calculate();
  });
  weeklyValues = saved.weeklyValues || {};
  applyTheme(saved.darkMode === true);
  $("darkMode").addEventListener("change", () => {
    const dark = $("darkMode").checked;
    applyTheme(dark);
    chrome.storage.local.set({ darkMode: dark });
  });
  $("mode").replaceChildren();
  for (const [value, mode] of Object.entries(modes)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = mode.label;
    $("mode").append(option);
  }
  $("mode").value = Object.hasOwn(modes, saved.mode) ? saved.mode : "manual";
  $("mode").addEventListener("change", () => {
    chrome.storage.local.set({ mode: $("mode").value });
    refresh(true);
  });
  periodValues.week.target = saved.target ?? "40";
  periodValues.day.target = saved.dailyTarget ?? "8";
  $("periodMode").value = saved.periodMode === "day" ? "day" : "week";
  $("periodMode").addEventListener("change", () => {
    chrome.storage.local.set({ periodMode: $("periodMode").value });
    calculate();
  });
  if (saved.start != null) $("start").value = saved.start;
  unpaidValues.manual = saved.manualTotalUnpaid ?? "0";
  unpaidValues.paychex = saved.paychexUnpaidOverride ?? "0";
  $("unpaidOverride").checked = !!saved.unpaidOverride;
  $("timeUnit").value = ["hours", "hoursMinutes"].includes(saved.timeUnit ?? saved.breakUnit) ? (saved.timeUnit ?? saved.breakUnit) : "minutes";
  function updateTimeInputs() {    for (const [period, id, max] of [["week", "weeklyTarget", 168], ["day", "dailyTarget", 24]]) {
      configureDurationInput($(id));
      $(id).value = durationValue(Number(periodValues[period].target) * 3600);
      $(id).max = max * 3600 / unitSeconds();
      $(id + "Label").textContent = (period === "week" ? "Weekly" : "Daily") + ` target (${unitLabel()})`;
    }
    updateUnpaidInput();
  }
  $("timeUnit").addEventListener("change", () => {
    updateTimeInputs();
    chrome.storage.local.set({ timeUnit: $("timeUnit").value });
    calculate();
  });
  for (const [period, id, storageKey] of [["week", "weeklyTarget", "target"], ["day", "dailyTarget", "dailyTarget"]]) {
    $(id).addEventListener("change", () => {
      if (!$(id).reportValidity()) return;
      periodValues[period].target = durationSeconds($(id).value) / 3600;
      chrome.storage.local.set({ [storageKey]: periodValues[period].target });
      calculate();
    });
  }
  updateTimeInputs();
  for (const key of ["start", "break"])
    $(key).addEventListener("change", () => {
      if (!$(key).reportValidity()) return;
      let value = $(key).value;
      let storageKey = key;
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
    $("refresh").hidden = show;
    $("closeSettings").hidden = !show;
    $("openSettings").setAttribute("aria-expanded", String(show));
    $("pageTitle").textContent = show ? "Settings" : "Work Time Left";
    $("modeSubtitle").hidden = show;
    (show ? $("closeSettings") : $("openSettings")).focus();
  }
  for (const [buttonId, helpId] of [["clockHelpButton", "clockHelp"], ["unpaidHelpButton", "unpaidHelp"]]) {
    const button = $(buttonId), help = $(helpId);
    let pinned = false;
    let hoverTimer;
    const show = (visible) => {
      clearTimeout(hoverTimer);
      help.hidden = !visible;
      button.setAttribute("aria-expanded", String(visible));
    };
    button.addEventListener("mouseenter", () => {
      if (!pinned && window.matchMedia("(hover: hover)").matches) {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => show(true), 1000);
      }
    });
    button.addEventListener("mouseleave", () => { if (!pinned) show(false); });
    button.addEventListener("click", () => { pinned = !pinned; show(pinned); });
    button.addEventListener("blur", () => { pinned = false; show(false); });
    document.addEventListener("click", (event) => {
      if (!button.contains(event.target) && !help.contains(event.target)) {
        pinned = false;
        show(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { pinned = false; show(false); }
    });
  }
  $("openSettings").addEventListener("click", () => showSettings(true));
  $("editTarget").addEventListener("click", () => {
    showSettings(true);
    $(isDaily() ? "dailyTarget" : "weeklyTarget").focus();
  });
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
  $("refresh").addEventListener("click", () => refresh(true));
  refresh();
  setInterval(() => {
    if (!$("weekTable").contains(document.activeElement)) calculate();
  }, 30000);
})();
