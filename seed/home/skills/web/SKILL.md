---
name: web
description: Find and read things on the web, and act on websites, by picking the right tool - web search, Firecrawl (search, scrape, crawl to Markdown), or a real browser (`browser` + `agent-browser`, on this machine or a Kernel/Browserbase cloud browser the owner can watch and take over in the Browser app). Use for research, monitoring sites, reading pages behind sign-in, filling forms, and sites without a usable API (Reddit, shops, dashboards).
---

# Web: search, scrape, or browse

Use the cheapest tool that works, and step up when it doesn't:

| Need | Tool | Needs |
|---|---|---|
| Find pages about something | your own web search tool, or `firecrawl search "…"`, or Brave (`$BRAVE_API_KEY`) | Firecrawl / Brave connection |
| Read a page or a whole site as Markdown | `firecrawl scrape <url>` / `firecrawl crawl <url>` / `firecrawl map <url>` | Firecrawl |
| Pull structured data from pages | `firecrawl scrape <url> --format json …` or `firecrawl agent "…"` | Firecrawl |
| A page that needs sign-in, clicks, scrolling or a form; a site that blocks scrapers | a real browser: `browser` + `agent-browser` | nothing (local); Kernel or Browserbase for cloud |

Check what's connected: `secret list` (FIRECRAWL_API_KEY, KERNEL_API_KEY, BROWSERBASE_API_KEY,
BRAVE_API_KEY), `browser backends`. Missing one you need: `secret request NAME "why"`.

## Firecrawl

`firecrawl --help` and `firecrawl <command> --help` for the details. It spends the owner's credits
(`firecrawl credits`), so scrape the pages you need rather than crawling whole sites. Output can be
large: write it to a file (`-o file.md`) and read what matters.

## A real browser

    browser start [name] [--profile P] [--url U]      # let it pick the route (below)
    agent-browser --session main open https://…
    agent-browser --session main snapshot -i        # the page's interactive elements as @refs
    agent-browser --session main click @e3 ; fill @e5 "text" ; press Enter ; get text body
    agent-browser --session main screenshot /tmp/x.png   # then look at it
    browser stop main                               # always, when done
    browser history [--job J] [--site S] [id]       # past sessions: sites, route, length, who, how it ended

- `agent-browser skills get core` is its full guide (refs, waits, tabs, downloads). Always pass
  `--session <name>`; without it agent-browser starts its own separate, unwatched browser. For a
  quick throwaway page without `browser start`, agent-browser needs `--args --no-sandbox` here;
  never put launch options in `~/.agent-browser/config.json` (it breaks `browser start`).
- **The owner can watch and take over** in the Browser app (`show browser`). When a sign-in, 2FA
  code or captcha blocks you, say so in one line, run `show browser`, and stop: ask them to do that
  step there and tell you when. Never ask for passwords in chat.
- **Never post, buy, send, delete or change settings** on a site without the owner's yes in this
  chat, the first time for each kind of action (see AGENTS.md, Care with the outside world). Reading
  is fine.

### Which route (`--via`)

Usually don't pass `--via`: `browser start` follows the owner's settings (Browser app → Ways to
browse; `browser backends` and `browser home` show them). The routes, cheapest first:

| Route | Sites see | Cost | Good for |
|---|---|---|---|
| `home` | the owner's home address (their device on Tailscale) | free | the owner's accounts; most sites. Needs that device awake |
| `kernel` | a residential address elsewhere (stealth proxy), solves captchas | ~$0.50/hour while running (free credit $5/month) | signed-out work when home is down or blocked |
| `browserbase --stealth` | a residential address; captchas sometimes | billed per GB of proxy traffic (pages can be several MB) | a second opinion when Kernel is blocked |
| `local` | this server's data-center address | free | sites that don't care (docs, your own tools) |

- Without `--stealth`, Browserbase uses a data-center address: Reddit and DataDome sites block it.
- Blocked or captcha'd? Retry once (Kernel's first visit often gets a captcha it then solves),
  then step up a route: `browser stop main && browser start main --via kernel` (a running browser
  keeps its route; asking for another one by the same name is refused). Don't loop: two blocked
  routes → stop and report.
- **Sign-ins stay home.** A `--profile` browser only runs through home; if home is down it refuses
  rather than falling back, so an account never shows up from another address. Profiles aren't
  shared between routes (home's live in `~/.config/springroll/browser/profiles/home-<P>`, Kernel's
  in Kernel), so signing in elsewhere means a different, empty profile: don't, tell the owner.
- Memory: each local/home browser takes 200–450 MB; at most two run at once. Reuse one by name
  (`browser start main` again reuses it) and stop it when done. Cloud browsers bill while attached.

### In jobs

- Signed-in work (a `--profile`) needs home: give the job an `onlyIf` of
  `browser home --json | jq -e .ok >/dev/null` so it's skipped (not failed) while the device sleeps,
  and `retries: 2`, `retryDelay: "30m"` if a late run still helps. Reading is safe to retry; never
  retry anything that posts.
- Signed-out reading can just run: home first, the owner's fallback (Kernel) when home is down.
- Say in the report which route was used if it wasn't home, and stop every browser you started
  (`browser stop <name>`) before the report, even after an error.

## Site notes

- **Reddit**: no API without Reddit's approval (since late 2025). Subreddit feeds work without it:
  `curl -s -A "springroll/1.0" https://www.reddit.com/r/<sub>/new.rss` (the `.json` endpoints return
  403; site search is rate-limited). Use Firecrawl or web search (`site:reddit.com …`) to find threads,
  the browser (`--via home --profile reddit`) to read whole threads or anything behind sign-in. Reddit bans
  accounts for automated posting: draft replies and posts for the owner; don't post unless they say
  so for that specific post.
