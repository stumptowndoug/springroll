#!/usr/bin/env node
// `browser`: start, list and stop browsers that agents drive with agent-browser and the owner
// watches (and takes over) in the Browser app. See views/browser/README.md.
import { startSession, stopSession, listSessions, backends } from './lib.mjs';
import { homeStatus, writeHome } from './home.mjs';
import * as history from './history.mjs';

const HELP = `browser: a real browser for agents, watched (and taken over) in the Browser app.

  browser start [name] [--via home|local|kernel|browserbase] [--profile P] [--stealth|--no-stealth] [--url U]
      Start a browser (or reuse the running one called name, default "main") and attach the
      agent-browser session of the same name. Then drive it:
        agent-browser --session main open https://…
        agent-browser --session main snapshot -i      (then click @e3, fill @e5 "…", …)
      --via      where it runs. Default: home when the home route is on (browser home on), else
                 kernel if KERNEL_API_KEY is set, else browserbase if BROWSERBASE_API_KEY is, else
                 local (headless Chromium on this machine, this server's address).
                 home = the local browser, leaving the internet from the owner's home (a device of theirs
                 over Tailscale). Checked before it starts and every 3 minutes while it runs.
      --profile  keeps sign-ins between sessions (local: ~/data/browser/profiles/P; Kernel and
                 Browserbase: a profile/context in that account). Local and home default to "default".
      --stealth  Kernel: on by default (proxy + captcha solving). Browserbase: off by default.
  browser list [--json]          what's running
  browser stop [name|--all]      stop it (cloud browsers bill while running: stop when done)
  browser history [--job J] [--site S] [--limit N] [--json]
                                 past sessions: sites, route, how long, who started it, how it ended
  browser history <id> [--json]  one session, with every page it showed
  browser backends               which backends are ready
  browser home [status]          is the home route working, and from which address
  browser home on|off            make home the default for browser start (or not)
  browser home fallback stop|kernel|local   when home is the default but down (default: stop);
                                 only for browsers without --profile: sign-ins always wait for home
  browser home node <device>     which Tailscale device is home (automatic when there's one)
  browser home accept            home's address changed: take the current one
  browser show [name]            open the Browser app (on that session) for the owner`;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--stealth') flags.stealth = true;
  else if (a === '--no-stealth') flags.stealth = false;
  else if (a === '--all' || a === '--json') flags[a.slice(2)] = true;
  else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
  else pos.push(a);
}

const line = (s) => [s.name, s.via, s.profile && `profile ${s.profile}`, new Date(s.started).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })].filter(Boolean).join(' · ');

try {
  if (cmd === 'start') {
    const s = await startSession({ name: pos[0], via: flags.via, profile: flags.profile, stealth: flags.stealth, url: flags.url });
    console.log(`${s.reused ? 'Reusing' : 'Started'} ${line(s)}`);
    console.log(`Drive it:  agent-browser --session ${s.name} open <url>   (snapshot -i, click @e1, fill, screenshot, …)`);
    console.log(`Owner watches/takes over: show browser   ·   stop when done: browser stop ${s.name}`);
    if (s.live) console.log(`Provider live view: ${s.live}`);
  } else if (cmd === 'stop') {
    const names = flags.all ? (await listSessions()).map((s) => s.name) : [pos[0] || 'main'];
    for (const n of names) { await stopSession(n); console.log(`Stopped ${n}`); }
    if (!names.length) console.log('Nothing running.');
  } else if (cmd === 'list' || cmd === 'ls') {
    const all = await listSessions();
    if (flags.json) console.log(JSON.stringify(all, null, 2));
    else console.log(all.length ? all.map(line).join('\n') : 'Nothing running.');
  } else if (cmd === 'history') {
    const dur = (sec) => (sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.round(sec / 60)}m` : `${(sec / 3600).toFixed(1)}h`);
    const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const from = (h) => h.job ? `job ${h.job}` : h.origin === 'chat' ? `chat ${h.thread}` : h.origin === 'app' ? 'the owner (app)' : h.origin;
    const how = (h) => h.live ? 'running' : h.endReason === 'failed' ? `failed: ${h.error}` : h.endReason;
    if (pos[0]) {
      const h = history.get(pos[0]);
      if (!h) throw new Error(`No session ${pos[0]} in the history.`);
      if (flags.json) console.log(JSON.stringify(h, null, 2));
      else {
        console.log(`#${h.id} ${h.name} · ${when(h.started)} · ${dur(h.seconds)} · ${how(h)}`);
        console.log(`Route: ${h.via}${h.exitIP ? ` (${h.exitIP})` : ''}${h.fallbackFrom ? ` instead of ${h.fallbackFrom}: ${h.fallbackReason}` : ''}${h.profile ? ` · profile ${h.profile}` : ''}`);
        console.log(`Started by: ${from(h)}${h.threadTitle ? ` ("${h.threadTitle}")` : ''}${h.alsoThreads.length ? ` · also used by ${h.alsoThreads.join(', ')}` : ''}`);
        for (const p of h.pageList) console.log(`  ${new Date(p.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}  ${p.url}${p.title ? `  ${p.title}` : ''}`);
      }
    } else {
      const all = history.list({ limit: flags.limit, job: flags.job, site: flags.site });
      if (flags.json) console.log(JSON.stringify(all, null, 2));
      else console.log(all.length ? all.map((h) => [`#${h.id}`, when(h.started), h.sites.slice(0, 3).join(', ') || '(no pages)', h.via, dur(h.seconds), `${h.pages} pages`, from(h), how(h)].join(' · ')).join('\n') : 'No browser sessions yet.');
    }
  } else if (cmd === 'backends') {
    for (const b of await backends()) console.log(`${b.via.padEnd(12)} ${b.ready ? 'ready' : b.reason || `needs ${b.key}`}`);
  } else if (cmd === 'home') {
    const [sub, arg] = pos;
    if (sub === 'on' || sub === 'off') writeHome({ enabled: sub === 'on' });
    else if (sub === 'fallback') { if (!['stop', 'kernel', 'local'].includes(arg)) throw new Error('fallback is stop, kernel or local'); writeHome({ fallback: arg }); }
    else if (sub === 'node') writeHome({ node: arg || null });
    else if (sub === 'accept') writeHome({ homeIP: null });
    else if (sub && sub !== 'status') throw new Error(`browser home ${sub}? (status, on, off, fallback, node, accept)`);
    const h = await homeStatus();
    if (flags.json) console.log(JSON.stringify(h, null, 2));
    else {
      console.log(h.ok ? `Working: browsers leave from ${h.ip} (home, via ${h.exitNode.name}).` : `Not working: ${h.reason}`);
      if (h.authURL) console.log(`Approve: ${h.authURL}`);
      console.log(`Default for browser start: ${h.enabled ? 'on' : 'off'} · when down: ${h.fallback}${h.homeIP ? ` · home address ${h.homeIP}` : ''}`);
    }
  } else if (cmd === 'show') {
    const { execFileSync } = await import('node:child_process');
    execFileSync('show', ['browser'], { stdio: 'inherit' });
  } else {
    console.log(HELP);
    if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') process.exit(1);
  }
} catch (e) {
  console.error(`browser: ${e.message}`);
  process.exit(1);
}
