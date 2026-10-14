// The home route: browsers that leave the internet from the owner's home connection. A second,
// userspace tailscaled (tailscale-browser.service) uses one of the owner's devices as its exit node
// and offers a SOCKS5 proxy; only browsers started with --via home use it. Nothing else on this
// machine is routed. Settings: ~/data/browser/home.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FILE = path.join(os.homedir(), 'data/browser/home.json');
export const SOCK = `/run/user/${process.getuid()}/tailscale-browser.sock`;
export const STATE_DIR = path.join(os.homedir(), '.config/springroll/tailscale-browser');
export const PROXY = 'socks5://127.0.0.1:1055';
const IP_URL = 'https://api.ipify.org';

// enabled: `browser start` without --via goes home. fallback when home isn't available:
// stop (refuse), kernel, or local (this server's own address).
const DEFAULTS = { enabled: false, fallback: 'stop', node: null, homeIP: null };
export const readHome = () => { try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; } };
export function writeHome(patch) {
  const next = { ...readHome(), ...patch };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n');
  return next;
}

const ts = async (...args) => (await run('tailscale', [`--socket=${SOCK}`, ...args], { timeout: 15000 })).stdout;
const ipVia = async (proxy) => {
  const args = ['-fsS', '--max-time', '10', ...(proxy ? ['--proxy', proxy.replace('socks5:', 'socks5h:')] : []), IP_URL];
  return (await run('curl', args, { timeout: 15000 })).stdout.trim();
};

// Everything the checks know, plus ok and (when not ok) the one-line reason.
export async function homeStatus({ fix = true } = {}) {
  const cfg = readHome();
  const out = { ...cfg, ok: false, reason: '', loggedIn: false, nodes: [], exitNode: null, ip: null, serverIP: null };
  let st;
  try { st = JSON.parse(await ts('status', '--json')); }
  catch { return { ...out, reason: fs.existsSync(STATE_DIR) ? 'The browser’s Tailscale connection isn’t running (tailscale-browser.service).' : 'Not set up (Browser app → Home internet → Set up).' }; }
  if (st.BackendState === 'NeedsLogin') return { ...out, reason: 'The browser’s Tailscale connection needs approving.', authURL: st.AuthURL || null };
  if (st.BackendState !== 'Running') return { ...out, reason: `The browser’s Tailscale connection is ${st.BackendState}.` };
  out.loggedIn = true;

  const peers = Object.values(st.Peer || {});
  out.nodes = peers.filter((p) => p.ExitNodeOption).map((p) => ({ name: p.HostName, dns: (p.DNSName || '').replace(/\.$/, ''), ip: p.TailscaleIPs?.[0], online: !!p.Online }));
  const want = cfg.node ? out.nodes.find((n) => [n.name, n.dns, n.ip, n.dns.split('.')[0]].includes(cfg.node)) : out.nodes.length === 1 ? out.nodes[0] : null;
  if (!want) {
    return { ...out, reason: out.nodes.length ? 'Pick which device is home (browser home node <name>).' : 'Approved. Now pick the device at home: in its Tailscale app turn on Run as exit node, then approve that in Tailscale’s admin page (Machines → the device → Edit route settings → Use as exit node).' };
  }
  out.exitNode = want;
  if (!want.online) return { ...out, reason: `${want.name} is offline (asleep or no internet).` };

  // Point the browser's tailscaled at it (a no-op when it already is).
  const cur = st.ExitNodeStatus?.TailscaleIPs?.map((x) => x.split('/')[0]) || [];
  if (!cur.includes(want.ip)) {
    if (!fix) return { ...out, reason: `Not routed through ${want.name} yet.` };
    await ts('set', `--exit-node=${want.ip}`, '--exit-node-allow-lan-access=false');
  }

  // The proof: the address websites see through the proxy is home's, not this server's.
  const [ip, serverIP] = await Promise.all([ipVia(PROXY).catch(() => null), ipVia(null).catch(() => null)]);
  Object.assign(out, { ip, serverIP });
  if (!ip) return { ...out, reason: `Couldn’t reach the internet through ${want.name}.` };
  if (ip === serverIP) return { ...out, reason: 'Traffic is leaving from this server, not from home.' };
  if (!cfg.homeIP) { writeHome({ homeIP: ip }); out.homeIP = ip; }
  else if (cfg.homeIP !== ip) return { ...out, reason: `${want.name} is online from ${ip}, not your home address ${cfg.homeIP}. If home’s address changed: browser home accept.` };
  return { ...out, ok: true };
}
