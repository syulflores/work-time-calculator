# Work Time Calculator

A Chrome extension that uses your Paychex timecard to estimate weekly work hours, time remaining toward a weekly target, and a projected clock-out time.

The extension is read-only: it uses timecard responses loaded by Paychex itself and never sends clock-in or clock-out requests.

## Features

- Calculate weekly hours from recorded regular and overtime entries.
- Choose a Sunday, Monday, or Saturday workweek start.
- Set a weekly hours target (40 hours by default).
- Estimate clock-out time using a detected open shift or a manually entered clock-in.
- Account for remaining unpaid break minutes.
- Save settings locally in your browser.

## Installation

1. Clone or download this repository. Extract the ZIP if you downloaded it.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project folder containing `manifest.json`.
5. Optionally pin **Work Time Calculator** to the Chrome toolbar.

No build step or additional dependencies are required. Microsoft Edge can also load the extension through `edge://extensions` using the same steps.

## Usage

1. Open `https://paychex.centralservers.com/`, sign in, and open your timecard.
2. Click the extension icon to open **Weekly hours** and initialize timecard capture.
3. With the Paychex tab still open, navigate within Paychex to load the timecard data again, then click **Refresh from Paychex** in the extension.
4. Set your workweek start, weekly target, and any **remaining** unpaid break minutes.
5. Review your hours, remaining time, and projected clock-out.

If Paychex does not return an open clock-in, enter today's clock-in and select **Use this clock-in to estimate clock-out**. Use **Clear manual clock-in** when you no longer need the override.

Keep Paychex open and signed in. Estimates recalculate every 30 seconds while the popup is open. To get fresh timecard data, load it again in Paychex and click **Refresh from Paychex**.

## Calculation notes

- Weekly totals use regular and overtime durations from the captured timecard, excluding entries marked as non-work.
- A detected or manually entered current shift can contribute elapsed time to the estimate.
- Manual mode assumes the running shift is not already included in recorded paid time. Confirm this against Paychex before relying on the result.
- Enter only unpaid break minutes that remain, rather than your total breaks for the day.
- Results are estimates, not official payroll totals. Verify Paychex rounding and your employer's payroll policies.

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
- **No timecard captured:** Open the extension first to initialize capture, then make Paychex load its timecard data again. After a full page reload, reopen the extension to initialize capture before navigating within Paychex to load timecard data.
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
`relay.js` owns validation of incoming and stored captures; the popup uses normalized dates and
numeric timestamps without parsing provider-specific date formats.

Load `relay.js` in the isolated world before loading the
provider bridge in the main world. The relay accepts same-window, same-origin
capture messages and stores each provider separately under
`capturedTimecard:<source>`. The popup requests the latest in-memory capture with
`{ type: "WORK_TIME_READ", source: "paychex" }`, the relay falls back to that provider's
validated stored capture. The response contains `schemaVersion`, `source`, `at`, and `entries`.
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
