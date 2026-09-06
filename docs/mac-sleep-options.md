# Mac sleep and scheduled recipes

Research and proposed direction, 2026-09-06. No power settings changed and no
wake events scheduled. Current behavior remains the [missed-run policy](missed-run-policy.md).

## Three separate capabilities

| Proposed setting | Behavior | Implementation direction |
| --- | --- | --- |
| Keep Mac awake during runs | Prevent idle system sleep while an authorized run is active; allow display sleep and screen lock. | A run-scoped IOKit assertion, or a supervised `caffeinate -i` process. |
| Keep Mac available while plugged in | Prevent idle sleep while Springroll is running and local schedules are enabled, including between jobs. | App-scoped assertion with power-source monitoring and clear status. |
| Wake Mac for scheduled recipes | Allow sleep between jobs and request a wake ahead of the next due recipe. | OS-owned timed wake registration and a narrowly privileged scheduling mechanism. Requires a device proof before shipping. |

Recommendation: implement active-run sleep prevention first, offer plugged-in
availability if users need overnight reliability immediately, and evaluate true
scheduled wake as a separate opt-in experiment. None should silently override
the user's machine-wide preferences. Release assertions on completion, failure,
cancellation, shutdown, and settings changes; do not hold them indefinitely while
waiting for human approval. Concurrent runs need shared ownership/reference counting.

## What Codex supports

Official desktop settings document **Prevent sleep while running**. Remote
connection settings also offer keeping the host awake. The remote guide requires
an awake, online host with the app running, and explicitly says remote access
stops when the host sleeps. It recommends power connected and the laptop lid open;
closed-lid availability requires an external display as well. Choosing Sleep
still stops remote access. This documents sleep prevention, not remote wake.

- [Desktop settings](https://learn.chatgpt.com/docs/reference/settings)
- [Remote connections and host requirements](https://learn.chatgpt.com/docs/remote-connections)

## macOS mechanisms and settings

Apple documents timed wake with `pmset`. The local macOS `pmset(1)` manual says
modifying settings requires root and supports owner-tagged, one-time wake events;
the global repeating schedule supports only one on/off pair. Prefer owned
one-time events for a Springroll prototype. Never overwrite the global repeating
schedule or cancel other applications' wake events.

The local `caffeinate(8)` manual distinguishes idle-system sleep prevention (`-i`)
from display prevention (`-d`) and user-activity/display wake (`-u`). Springroll
should not use the latter two just to execute an API recipe. An ordinary process
timer cannot wake a sleeping Mac by itself.

The system **Prevent automatic sleeping on power adapter when the display is
off** setting can provide a manual always-available setup while plugged in.
It affects the whole Mac; app-scoped assertions give Springroll better lifecycle
control. **Wake for network access** supports access to shared resources and is
not a substitute for registering recipe wake times. Remote Login/SSH and screen
sharing need not be enabled for a local scheduled recipe.

- [Apple: schedule power events](https://support.apple.com/en-ca/guide/mac-help/mchl40376151/mac)
- [Apple: sleep and network-access settings](https://support.apple.com/guide/mac-help/if-your-mac-sleeps-or-wakes-unexpectedly-mchlp2995/mac)
- Local implementation references: `man pmset`, `man caffeinate`.

## Scheduled-wake experiment

Start with AC power, lid open, a logged-in session, and Springroll still running.
An off display or locked screen is distinct from logout or shutdown. Do not
promise closed-lid, battery, power-on, or pre-login execution. Apple notes that
FileVault requires login after startup; waking an existing session avoids that
startup requirement but still needs real Keychain-access validation.

1. Register an owned wake shortly before the next eligible recipe, allowing time
   for networking to recover. Have the OS accept and report the registration.
2. On resume, reconcile the persisted schedule and acquire an active-run assertion.
   Preserve ordinary occurrence claims and skip/catch-up semantics. Wake is only
   a preparation signal, not a second scheduler or permission to run early.
3. Recompute after recipe changes, pause/delete, time-zone changes, and restart.
   Cancel only Springroll-owned events when disabling the setting or quitting.
   Define a bounded rolling registration window if one wake is insufficient.
4. Expose the next requested wake and unavailable/failed status. Define a narrow,
   authenticated helper contract if elevated scheduling is needed; never run the
   full app or agent as root or request a password for each recipe.
5. Test idle sleep, explicit Sleep, AC removal, closed lid, network restoration,
   locked session/Keychain, overlapping jobs, crashes, and helper removal. Treat
   unsupported states as missed runs with clear status. Release the assertion
   after work and let macOS decide when to sleep; do not force the user to sleep.

Remote availability, reliable scheduled wake, and cloud execution are distinct
product choices. Hosted execution remains deferred and would require separately
authorized credentials; it is not necessary for this local experiment.
