# Work Time Calculator

A Chrome extension that estimates daily or weekly clock-out time from manual inputs or your Paychex timecard.

The extension is read-only: it uses timecard responses loaded by Paychex itself and never sends clock-in or clock-out requests.

## Features

- Manual or Paychex daily and weekly clock-out estimates.
- Shared equation: first clock-in + today's paid target + total unpaid time.
- Daily target defaults to 8 hours; weekly target defaults to 40 hours.
- Weekly mode subtracts paid hours completed before today from the weekly target.
- Settings saved locally; estimates refresh every 30 seconds while the popup is open.

## Installation

1. Clone or download this repository. Extract the ZIP if you downloaded it.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder containing `manifest.json`.
5. Optionally pin **Work Time Calculator** to the Chrome toolbar.

No build step or additional dependencies are required. Microsoft Edge can also load the extension through `edge://extensions` using the same steps.

## Usage

### Manual

1. Open Settings using the gear, select Manual and Day, and set your target and time units.
   Return with the back arrow beside the Settings title.
2. Enter your first clock-in today.
3. Enter total unpaid minutes for today, including lunch already taken and any planned unpaid breaks.
4. Review the projected clock-out and time until that projection (including unpaid time).

For example: 8:00 AM + 8 paid hours + 30 unpaid minutes = 4:30 PM.
Daily mode needs no recorded-hours input. For Week, the calculator shows seven dated columns starting on your configured week start,
with Clock-in and Unpaid rows. Enter today's values in today's column. You can also enter
other days; future values set the planned clock-in and unpaid time for those days. Manual mode adds the paid targets for earlier days in the grid and subtracts that total
from the weekly target. Adjust those past values to match the paid hours you actually worked.
The weekly projection allocates remaining paid hours across weekdays using the daily target.
Blank future weekdays use today's clock-in and unpaid time. An entered weekend clock-in
includes that day in the plan. If the target exceeds planned hours in the current week,
the calculator reports that instead of extending one shift overnight.

Weekly inputs are saved separately by provider and calendar date; a new week starts with blank
clock-ins and zero unpaid time. Daily inputs remain separate.

### Paychex

1. Open Paychex, sign in, and open the extension with Paychex mode selected.
2. Reload the Paychex timecard page, then click Refresh from Paychex. Capture stays enabled across page reloads while Paychex mode is selected.
3. Select Day or Week and set your paid-hours target.
4. Leave the manual clock-in checkbox off to use today's earliest captured clock-in.
   Enable it only to override that with today's first clock-in.
5. Captured unpaid time fills the unpaid input automatically. To change it, enable the override and enter the total unpaid time for today, including planned breaks.

In Week mode, captured clock-in and unpaid values appear for each available day. Each field
has its own manual override checkbox. Missing fields are editable without checking an override;
zero captured unpaid time is a valid value. Prior paid time still comes from the timecard,
so overriding a past clock-in or unpaid value does not change recorded paid totals.

## Calculation notes

Both modes use: projected clock-out = first clock-in + today's paid target + total unpaid time.
Time until projected clock-out = projected clock-out minus now, with a minimum of zero.
The projection stays at the calculated time after the target has been reached.

Paychex uses today's earliest valid clock-in. It estimates unpaid time as the larger of
reported unpaid duration and gaps between captured punches, avoiding double-counting lunch.
The unpaid override replaces that estimate with your entered total. This is a heuristic: incomplete records,
paid gaps, or unpaid deductions separate from punch gaps can produce an inaccurate estimate.
Paychex targets remain extension settings, not values extracted from the timecard.

Weekly Paychex mode sums recorded regular and overtime seconds before today, excluding
non-work and exact duplicate rows. Manual weekly mode totals the paid targets for earlier days in the displayed week.
Remaining weekly paid time is the weekly target minus earlier paid hours, with a minimum of zero.
Manual daily mode does not use stored recorded hours. Daily and weekly targets remain separate.

Open the gear icon to replace the calculator view with Settings. Settings appear in this order:
Mode, Calculate for, Weekly target, Daily target, and Time units, followed by Week starts.
Week starts is always visible. Use the back arrow beside the Settings title (or Escape) to return. Changes save automatically.

Time units apply to targets, unpaid time, and duration results.
Choose decimal Hours (for example, 0.5 or 0.87) or Minutes. Clock-in and clock-out remain clock times.
Switching units converts the current amount: 0.5 hours = 30 minutes; 0.87 hours = 52.2 minutes.
The selected unit is remembered. Switching units converts all duration inputs without changing
the projected clock-out. Stored global targets remain hours; stored unpaid values
remain minutes for compatibility. The previous unpaid-unit preference is used until a global
time-unit preference is saved.

Manual and Paychex total-unpaid overrides are saved separately.
Always check today's clock-in and break inputs: saved settings do not reset automatically each day.
The equation assumes all other elapsed time is paid and does not apply payroll rounding,
overtime premiums, or automatic clock-in/out actions. Overnight manual shifts are not supported.
Results are estimates; verify your employer's payroll policies.

## Privacy and permissions

Settings and the latest captured timecard are stored locally using Chrome extension storage. The extension does not send this data to an external service or ask for your Paychex credentials.

| Permission | Purpose |
| --- | --- |
| `activeTab` | Enables access to the active tab when you interact with the extension. |
| `scripting` | Installs the timecard capture and relay scripts in the Paychex tab. |
| `storage` | Saves preferences and the latest captured timecard locally. |
| `https://paychex.centralservers.com/*` | Provides access to the supported Paychex site. |

## Troubleshooting

- **No Paychex tab found:** Open the supported Paychex site and sign in before refreshing the extension.
- **No timecard captured:** Select Paychex mode in the extension once, reload the Paychex timecard page, then click Refresh from Paychex.
- **Old totals:** Check the capture time shown in the popup. Load updated timecard data in Paychex, then click **Refresh from Paychex**.
- **Clock-out unavailable:** Enter today's clock-in and enable manual mode. The estimate requires a clock-in in the past and less than 24 hours old.

## Development

This is a Manifest V3 extension built with plain JavaScript, HTML, and CSS.

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension metadata, permissions, and popup configuration. |
| `popup.html` | Popup interface. |
| `popup.js` | Preferences, weekly calculations, and refresh behavior. |
| `style.css` | Popup styling. |
| `bridge-paychex.js` | Captures Paychex's own successful timecard responses. |
| `relay.js` | Relays captured data to the extension and local storage. |

After editing the source, click **Reload** on the extension's card at `chrome://extensions`. Reload the Paychex tab and repeat the capture steps above to use updated scripts.

### Bridge contract

Each provider bridge translates its native responses into this message, posted
with `window.postMessage(message, location.origin)`:

```js
{
  channel: "work-time-capture-v1",
  type: "capture",
  schemaVersion: 1,
  normalizationVersion: 2, // Paychex punch wall-clock conversion revision.
  source: "paychex", // Stable provider identifier, e.g. "paylocity".
  at: 1793692800000, // Capture timestamp: Unix milliseconds.
  entries: [{
    date: "2026-11-03", // Payroll date, YYYY-MM-DD; do not shift by local timezone.
    in: 1793692800000, // Unix milliseconds, or null when unavailable.
    out: null,        // Unix milliseconds, or null for an open row.
    regular: 3600,    // Recorded regular paid seconds.
    ot: 0,           // Recorded overtime paid seconds.
    unpaid: 0,       // Unpaid seconds; not included in paid totals.
    nonwork: false,   // True for rows excluded from work totals.
    payType: "Regular"
  }]
}
```

Send one row per top-level timecard group; do not also emit its detail rows.
Durations must be finite nonnegative numbers. An empty entries array is valid.
Paychex .NET punch dates encode wall-clock components; the bridge reconstructs those
components in the browser's local timezone. Use the same timezone as your Paychex
timecard. Payroll dates remain calendar labels. Captures from the old punch
conversion are rejected; reload the timecard to replace them after upgrading.
`relay.js` owns validation of incoming and stored captures; the popup uses normalized dates and
numeric timestamps without parsing provider-specific date formats. The relay filters the requested period and converts records into calculation inputs: `firstClockIn` (milliseconds or null), `previousPaid` (seconds), `totalUnpaid` (seconds), and `todayRecords`. Daily mode uses only today; weekly mode also totals paid time before today.

Load `relay.js` in the isolated world before loading the
provider bridge in the main world. The relay accepts same-window, same-origin
capture messages and stores each provider separately under
`capturedTimecard:<source>`. The popup requests the latest in-memory capture with
`{ type: "WORK_TIME_READ", source: "paychex", periodMode: "day", today: "2026-11-10", first: "2026-11-10", last: "2026-11-10", now: Date.now() }`, the relay falls back to that provider's
validated stored capture. The response contains `schemaVersion`, `source`, `at`, `entries`, and period-specific `inputs`.
The relay retains the guard for invalidated extension contexts.

To add another integration, implement its bridge, register its popup mode and
refresh handler, and add its domain permissions. Paychex is currently the only
implemented provider. Older Paychex cache entries are not used by this format;
reload the timecard after installing the bridge and refresh to capture new data.

### Integration lifecycle

Manual mode stops installed bridges and relays across registered provider tabs.
Only the selected provider's chosen tab is started. Other provider tabs remain
stopped. Refresh operations are serialized, and obsolete requests cannot start
another integration after the mode changes. The relay also watches saved mode
changes and stops itself and its bridge when its provider is deselected.

A bridge exposes `window.__workTimeBridge = { stop }` in the main world. Its stop
function restores the request handlers it installed, removes listeners, and
prevents pending responses from publishing captures. It also handles the
same-window `work-time-capture-v1` message with `type: "stop"` from the relay.
The relay exposes its own stop function in the isolated world and removes its
message and storage listeners on shutdown. Before injecting the relay, set
`window.__workTimeSource` in the isolated world to the selected provider ID.
Register each future provider's URL pattern and bridge filename in `modes` so
mode changes can stop its scripts as well.

After upgrading from scripts without lifecycle support, reload existing Paychex
tabs once to remove the previously injected scripts.

Run the bridge/relay/popup fixture checks with `node tests/paychex.test.cjs`. These checks use simulated Paychex responses; they do not verify the live site.

Weekly grid and per-day relay checks: `node tests/weekly.test.cjs`.

Weekly mode includes an editable **Paid target** row in the selected duration units.
Weekdays default to the daily target, and weekends default to zero. Set a day's target
to zero to skip it, or clear it to restore its default. Targets save by date and provider.
Changing today's or a future day's target redistributes the remaining weekly hours;
for example, planning nine paid hours Thursday instead of eight moves Friday's finish
one hour earlier. In Manual mode, past targets count as completed paid hours. Integrations continue to use recorded earlier paid totals.

The **Countdown** setting defaults to **Working hours**, which shows remaining paid
work across planned shifts and excludes overnight gaps and unpaid duration. Choose
**Elapsed time** to show all time until the same projected clock-out, including breaks
and nights. This preference is saved and applies to Day and Week in every mode.
Because break start/end times are not available to the planner, working time uses
elapsed shift time minus the day's total unpaid duration, clamped to the paid target.
If that total includes a planned break not yet taken, the working countdown is an estimate.
