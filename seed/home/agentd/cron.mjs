// Five-field cron (minute hour day-of-month month day-of-week), local time,
// plus plain-English descriptions for the common shapes.
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]; // weekday 7 is Sunday too
const ALIASES = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *' };

function field(spec, [lo, hi]) {
  const set = new Set();
  for (const part of spec.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    let a = lo, b = hi;
    if (range !== '*') {
      const [x, y] = range.split('-').map((n) => parseInt(n, 10));
      a = x; b = y ?? (stepStr ? hi : x);
    }
    if ([a, b, step].some(Number.isNaN) || a < lo || b > hi || step < 1) throw new Error(`bad cron field "${spec}"`);
    for (let v = a; v <= b; v += step) set.add(v);
  }
  return set;
}

export function parseCron(expr) {
  const parts = (ALIASES[expr.trim()] || expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron needs 5 fields: minute hour day month weekday');
  const sets = parts.map((p, i) => field(p, RANGES[i]));
  if (sets[4].delete(7)) sets[4].add(0);
  return { sets, domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

export function nextRun(expr, after = new Date()) {
  const { sets: [min, hour, dom, mon, dow], domStar, dowStar } = parseCron(expr);
  const d = new Date(after.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dayOk = domStar || dowStar ? dom.has(d.getDate()) && dow.has(d.getDay()) : dom.has(d.getDate()) || dow.has(d.getDay());
    if (mon.has(d.getMonth() + 1) && dayOk && hour.has(d.getHours()) && min.has(d.getMinutes())) return d;
    if (!mon.has(d.getMonth() + 1) || !dayOk) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!hour.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

const time = (h, m) => new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function describeCron(expr) {
  const e = (ALIASES[expr.trim()] || expr).trim();
  const [m, h, dom, mon, dow] = e.split(/\s+/);
  const num = (s) => /^\d+$/.test(s);
  if (/^\*\/\d+$/.test(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${m.slice(2)} minutes`;
  if (num(m) && h === '*' && dom === '*' && dow === '*') return `Hourly at :${m.padStart(2, '0')}`;
  if (num(m) && /^\*\/\d+$/.test(h) && dom === '*' && dow === '*') return `Every ${h.slice(2)} hours at :${m.padStart(2, '0')}`;
  if (num(m) && num(h) && dom === '*' && mon === '*') {
    const at = time(+h, +m);
    if (dow === '*') return `Daily at ${at}`;
    if (dow === '1-5') return `Weekdays at ${at}`;
    if (dow === '0,6' || dow === '6,0') return `Weekends at ${at}`;
    if (num(dow)) return `${DAYS[+dow % 7]}s at ${at}`;
  }
  if (num(m) && num(h) && num(dom) && mon === '*' && dow === '*') return `Monthly on day ${dom} at ${time(+h, +m)}`;
  return e;
}
