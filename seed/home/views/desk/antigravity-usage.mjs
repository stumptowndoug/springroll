// Antigravity's authenticated /usage command, following Shep's antigravity_cli.rs.
// Version-gated: older CLIs may interpret /usage as a model prompt.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAX_OUTPUT = 1024 * 1024;
const BUCKETS = {
  'gemini-weekly': { label: 'Gemini weekly', windowMs: 168 * 3600000 },
  'gemini-5h': { label: 'Gemini 5-hour', windowMs: 5 * 3600000 },
  '3p-weekly': { label: 'Claude + GPT weekly', windowMs: 168 * 3600000 },
  '3p-5h': { label: 'Claude + GPT 5-hour', windowMs: 5 * 3600000 },
};

export class AntigravityUsageError extends Error {}

export function supportsUsageReport(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version.trim())) return false;
  const [major, minor, patch] = version.trim().split('.').map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return major > 1 || (major === 1 && (minor > 1 || (minor === 1 && patch >= 11)));
}

export function parseAntigravityUsage(body) {
  let report;
  try { report = JSON.parse(body); }
  catch { throw new AntigravityUsageError('Antigravity returned an invalid usage report'); }
  if (report?.status !== 'SUCCESS' || report?.command?.name !== 'usage'
      || (report.num_turns != null && report.num_turns !== 0))
    throw new AntigravityUsageError('Antigravity usage report failed; check /usage in agy');
  const groups = report.command.data?.groups;
  if (!Array.isArray(groups))
    throw new AntigravityUsageError('Antigravity usage report is missing quota groups');
  const windows = [], seen = new Set();
  for (const group of groups) {
    if (!group || group.disabled === true || group.enabled === false || !Array.isArray(group.buckets)) continue;
    for (const bucket of group.buckets) {
      if (!bucket || bucket.disabled === true || bucket.enabled === false) continue;
      const definition = Object.hasOwn(BUCKETS, bucket.id) ? BUCKETS[bucket.id] : null;
      const fraction = bucket.remaining_fraction;
      if (!definition || typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue;
      if (seen.has(bucket.id)) throw new AntigravityUsageError('Antigravity usage report contains duplicate quota buckets');
      seen.add(bucket.id);
      const reset = typeof bucket.reset_time === 'string' ? Date.parse(bucket.reset_time) : NaN;
      windows.push({ key: bucket.id, ...definition, used: Math.round((1 - fraction) * 100), resetsAt: Number.isFinite(reset) ? reset : null });
    }
  }
  if (!windows.length) throw new AntigravityUsageError('Antigravity usage report has no supported quota values');
  return { windows };
}

function run(binary, args, cwd, timeout) {
  return new Promise((resolve, reject) => {
    // A dedicated process group lets a timeout also stop the CLI's helper processes.
    const child = spawn(binary, args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    let size = 0, failure = null;
    const stop = () => {
      if (process.platform !== 'win32' && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
      try { child.kill('SIGKILL'); } catch {}
    };
    const timer = setTimeout(() => {
      failure = new AntigravityUsageError('Antigravity usage command timed out; retry shortly');
      stop();
    }, timeout);
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) {
        failure ||= new AntigravityUsageError('Antigravity usage report exceeded the size limit');
        stop();
      } else chunks.push(chunk);
    });
    child.once('error', () => {
      failure ||= new AntigravityUsageError('Unable to start Antigravity usage command');
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) failure ||= new AntigravityUsageError('Antigravity usage command failed; check that agy is signed in and /usage works');
      stop(); // Close any pipes inherited by helper processes, even on success.
    });
    child.once('close', () => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

export async function fetchAntigravityUsage({ binary = 'agy', timeout = 40000 } = {}) {
  let directory;
  try {
    // Keep repo instructions and conversation history out of this read-only probe.
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'springroll-agy-usage-'));
    const version = await run(binary, ['--version'], directory, Math.min(5000, timeout));
    if (!supportsUsageReport(version))
      throw new AntigravityUsageError('Antigravity usage requires agy 1.1.11 or newer; update agy to see usage');
    const body = await run(binary, ['-p', '/usage', '--output-format', 'json', '--print-timeout', '30s'], directory, timeout);
    return parseAntigravityUsage(body);
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}
