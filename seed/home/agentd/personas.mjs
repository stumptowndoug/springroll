// Personas: presets for how the agent talks in a chat (~/home/personas/<id>.md, see its README).
// A chat's persona travels in its messages, not the system prompt: every agent supports that, and it
// can change mid-chat. The whole preset goes with the first message after a switch, then a one-line
// reminder with each message so the voice doesn't fade over a long chat.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const PERSONAS_DIR = path.join(os.homedir(), 'home', 'personas');
const SUBSTANCE = 'Only the voice changes: the facts, what you do, AGENTS.md and approvals stay as they are.';

function parse(id, text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  for (const line of (m ? m[1] : '').split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { id, name: meta.name || id, icon: meta.icon || 'drama', description: meta.description || '', body: (m ? m[2] : text).trim() };
}

export function listPersonas(dir = PERSONAS_DIR) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^[a-z0-9-]+\.md$/.test(f) && f !== 'README.md'); } catch {}
  return files.map((f) => {
    try { return parse(f.slice(0, -3), fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

export const getPersona = (id, dir = PERSONAS_DIR) => (id && /^[a-z0-9-]+$/.test(id) ? listPersonas(dir).find((p) => p.id === id) || null : null);

// What a prompt carries for the chat's persona, given what this session was last sent (`sent`: a
// persona id, or null). Returns { text, sent } (text null when there's nothing to say).
export function personaText(id, sent, dir = PERSONAS_DIR) {
  const p = getPersona(id, dir);
  if (!p) return { text: sent ? '[Persona off: from now on, speak in your normal voice.]' : null, sent: null };
  if (sent === p.id) return { text: `[Persona: ${p.name} (${path.join(dir, p.id + '.md').replace(os.homedir(), '~')}): stay in character. ${SUBSTANCE}]`, sent };
  return { text: `[Persona: ${p.name}. The owner asked you to play this part in this chat: be the actor, commit to the personality and style below in everything you write to them, and have fun with it. ${SUBSTANCE}]\n${p.body}`, sent: p.id };
}
