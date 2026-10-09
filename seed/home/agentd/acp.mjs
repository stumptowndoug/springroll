// A minimal Agent Client Protocol (ACP) client: JSON-RPC 2.0 over a child
// process's stdin/stdout, one JSON message per line. Any harness with an ACP
// mode (claude-agent-acp, codex-acp, opencode acp, pi-acp, ...) works.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class AcpConnection extends EventEmitter {
  constructor({ command, args = [], cwd, env, scope = null, memoryHigh = '2G' }) {
    super();
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.stderr = '';
    // Each agent gets its own systemd scope (measurable, cappable, killed
    // before the Desk under memory pressure) when the user manager is reachable.
    const [cmd, argv] = scope ? ['systemd-run', ['--user', '--scope', '--quiet', '--collect', `--unit=${scope}`, '-p', `MemoryHigh=${memoryHigh}`,
      '--', 'bash', '-c', 'echo 500 > /proc/self/oom_score_adj 2>/dev/null; exec "$@"', 'agent', command, ...args]] : [command, args];
    this.proc = spawn(cmd, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    this.proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.#receive(line);
      }
    });
    this.proc.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-4000); });
    this.proc.on('error', (e) => this.#close(e.message));
    this.proc.on('exit', (code, signal) => this.#close(`exited (${signal || code})`));
    this.proc.stdin.on('error', () => {});
  }

  get pid() { return this.proc.pid; }

  #receive(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || 'ACP error'), { code: msg.error.code, data: msg.error.data }));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method && msg.id != null) {
      // A request from the agent to us (permissions, fs, terminal).
      this.emit('request', msg.method, msg.params || {}, {
        respond: (result) => this.#send({ jsonrpc: '2.0', id: msg.id, result }),
        fail: (code, message) => this.#send({ jsonrpc: '2.0', id: msg.id, error: { code, message } }),
        id: msg.id,
      });
      return;
    }
    if (msg.method) this.emit('notification', msg.method, msg.params || {});
  }

  #send(obj) {
    if (this.closed) return;
    try { this.proc.stdin.write(JSON.stringify(obj) + '\n'); } catch {}
  }

  #close(reason) {
    if (this.closed) return;
    this.closed = true;
    const err = new Error(`agent ${reason}${this.stderr ? ': ' + this.stderr.trim().split('\n').slice(-3).join(' | ') : ''}`);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.emit('close', err);
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error('agent is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) { this.#send({ jsonrpc: '2.0', method, params }); }

  kill() {
    if (this.closed) return;
    try { this.proc.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { this.proc.kill('SIGKILL'); } catch {} }, 3000).unref();
  }
}
