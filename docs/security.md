# Security

Springroll gives coding agents full control of a machine. That's what makes it useful, and it
decides everything else: put it on a box you can afford to lose, keep it private, and give it
accounts one at a time.

## What the agents can do

- **Everything on the box.** Agents run as the `agent` user, with passwordless `sudo`, a shell and
  the network. Chats start in **Full access** by default: the machine is the sandbox. Switch a chat
  to **Ask first** and you approve each action as it comes.
- **Everything their keys allow.** Every key in Keys is an environment variable in every chat and
  job. A GitHub token with write access means an agent can push.
- **What they read goes to the model.** Your prompts, and whatever an agent reads to answer them
  (files, mail, web pages), go to the provider of the agent you signed in: Anthropic, OpenAI, and
  so on.

Mail and web pages are untrusted input, and an agent with full access reads them. Connect
read-only first, and keep tokens as narrow as the service allows.

## What keeps the outside world safe

- **Email waits for you.** Connections → Gmail defaults to "Ask me first": `gmail send` and
  `gmail reply` refuse without `--approved`, and agents are told to pass it only after you've seen
  the exact email in the chat and said yes. It's a hard stop against an agent that forgot, not
  against one that's been talked into it. Switch it to "Send right away" only when you mean it.
  `gmail` has no delete.
- **First times are asked.** `AGENTS.md`, which every agent reads first, tells them to ask before
  posting, paying or deleting anything in your accounts the first time, and to start every new
  integration read-only. That's an instruction, not a lock: Ask first mode is the lock.
- **Receipts.** Every chat and job run is kept: each step, each command, each diff. Agents commit
  their changes to `~/home` with a message saying what and why.

## The network

- **Nothing is public.** Springroll and every app listen on `127.0.0.1` only.
- **You reach it privately**: over [Tailscale](https://tailscale.com) (`tailscale serve`, HTTPS on
  your tailnet's name), or through exe.dev's private login on exe.dev. Never make it public:
  whoever reaches Springroll can run commands on the machine.
- **On a VPS**, allow inbound SSH (key only) and Tailscale, nothing else. Expose another app with
  `tailscale serve`, never on the public IP.

## Keys

- Kept in `~/.config/springroll/secrets.env`, readable only by the agent's user, never in git.
- Agents ask for a key with `secret request`: a card on the Timeline, and you paste it there.
  You never paste a key into a chat, where it would go to the model provider. Springroll also masks
  key values in chat transcripts, as a second line.
- Apps read keys on their server, never in the page.
- Backups encrypt keys and sign-ins with your passphrase. The rest of a backup (the repo and app
  data) is plain inside the file; off-machine copies are encrypted end to end by restic.

## Reporting a problem

Found a hole? Report it privately on GitHub (Security → Report a vulnerability) rather than in a
public issue.
