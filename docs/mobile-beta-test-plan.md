# Mobile beta acceptance — PWA 6.4.0

Run this with at least one iPhone (Safari, installed PWA) and one Android device (Chrome, installed PWA).

| Area | Scenario | Expected result |
| --- | --- | --- |
| Install | Add the site to Home Screen, open it cold | App opens without browser chrome blocking controls; no horizontal scroll |
| Navigation | Open all four bottom tabs and return to Home | Bottom navigation stays fixed at the physical bottom and is reachable with one thumb |
| Keyboard | Focus login and tariff inputs | Font size remains readable; iOS does not zoom; dock does not jump above the keyboard permanently |
| Address data | Create two addresses and save different templates | Each address restores only its own template/reminders after refresh and relogin |
| Disabled service | Turn a service off | It disappears from current calculator, tariff controls and reminders, while prior historical records stay visible |
| Offline | Disable connectivity, modify a tariff/reminder, reopen, reconnect | Local change remains visible and the latest snapshot syncs once online |
| Accessibility | Use larger system text, VoiceOver/TalkBack and keyboard | Controls have labels, dialogs trap focus, status messages are announced |
| Update | Deploy a test update, refresh/install app | Update prompt is clear; applying it does not trap the user in stale cached assets |
| Recovery | Export JSON, then import it into a clean test account | Addresses, records, templates and reminders restore correctly |

Acceptance rule: no blocker or data-loss issue; any visual issue that hides a primary action on a 390 px-wide screen blocks release.
