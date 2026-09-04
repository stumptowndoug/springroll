# Built-in web research

Settings → Built-in capabilities → Web research configures public-web access
for chats and recipe runs independently of the model provider.

- **Search provider:** Exa, Parallel, or Firecrawl.
- **Page reader:** Exa with direct fallback, Parallel, Firecrawl, or direct HTTP reading.
- Connect keys before selecting paid providers. Connecting a key does not change defaults.
- Verification performs a small search and may consume provider credits.
- Keys stay in macOS Keychain. Defaults live in the existing `builtin-web` connection configuration.
- Existing installations retain Exa search (including its keyless MCP path) and Exa/direct reading.
- Search and reading can use different providers. Chats and recipe runs share these app-wide defaults; there are no per-conversation research overrides in this release.
- Disconnecting a selected Parallel or Firecrawl provider requires selecting another provider first. A provider failure does not silently switch to another paid provider.

The model continues to call `search_web` and `fetch_public_url`. Input schemas,
connection IDs, and recipe tool pins stay stable. The built-in source resolves
the configured providers when opening a tool session. Search results carry
source URLs, provider identity, and any returned usage metadata; page reads
are bounded and retain source attribution. Retrieval timestamps do not prove
that a page's claims are current. Public-URL checks precede Parallel/Firecrawl
page reads. Credentials are redacted from provider responses and transport errors.

Parallel uses [Search](https://docs.parallel.ai/api-reference/search/search)
and [Extract](https://docs.parallel.ai/api-reference/extract/extract) at `/v1`.
Firecrawl uses [Search](https://docs.firecrawl.dev/api-reference/endpoint/search)
and [Scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape) at `/v2`.
Firecrawl reads request fresh Markdown content and use local focused excerpt selection.

Search and scraping charges are separate from model tokens. Provider-reported
usage is included where available; these charges are not yet converted into
USD or added to Springroll's model-cost totals. Live paid-provider acceptance
requires user-supplied keys. Specialized crawling, SEO, and rank-tracking
workflows can use ordinary integrations alongside these built-in capabilities.
