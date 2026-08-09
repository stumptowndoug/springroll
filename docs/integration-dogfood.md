# Integration creation dogfood

Date: 2026-08-08

## Goal

Exercise integration creation with the same free-form prompts an end user would enter, across curated OAuth connectors, remote MCP, local MCP packages, OpenAPI, no-auth connectors, API-key connectors, raw URLs, and already-prepared manifests. A successful result is a native Springroll review card—not an assistant claim that setup happened.

## Method and limitation

Prompts were sent through the running app's durable chat HTTP boundary (`connection.create` context), and the resulting assistant messages, tool trace, workflow cards, token usage, and persisted connection catalog were inspected. The initial matrix stopped before acceptance; the later disposable no-auth slices accepted, tested, and removed their connectors. No production credential or external OAuth flow was started.

The in-app browser runtime reported no available browser, so visual clicking and screenshot verification remain open. The HTTP path is the real application boundary, but it does not prove the final rendered interaction or keyboard/accessibility behavior.

## Prompt matrix

| Path | User-style prompt | Result | Evidence |
| --- | --- | --- | --- |
| Curated OAuth MCP | “Connect Jira so I can summarize overdue issues every Monday.” | Native Jira OAuth setup proposal. Acceptance intentionally not started. | Chat `5db6e946-6b02-468d-9a7d-1efc631c3ce6` |
| OAuth registration unavailable | “Connect Gmail so I can triage unread customer messages each morning.” | Correctly stopped on missing Springroll OAuth client registration; did not ask for a secret or invent a fallback. | Chat `965432ba-b0f4-4379-8b12-3c5541c47800` |
| Prepared local MCP + API key | “Connect Firebase MCP so I can summarize recent project errors.” | Initially ignored the prepared manifest. After repair, immediately created a native setup card whose host form will collect the Firebase token. | Before: `9b59d27f-3534-4a88-9eb2-f8970b73a254`; after: `433e4110-a36a-42ed-a3f6-359f960a2179` |
| Registry miss → official remote MCP | “Connect Stripe so I can build a weekly recipe that summarizes successful payments and failed charges.” | Initially asked the user to supply documentation. After repair, automatically searched Stripe-owned sources, inspected `docs.stripe.com/mcp`, validated the OAuth MCP transport, and created a native setup proposal. | Before: `5cf77c5f-d498-42d3-aadd-2217da9c2211`; after: `bc463a7d-576f-4096-89c0-16e6284a44e0` |
| Raw remote MCP URL | “Connect the remote Context7 MCP at `https://mcp.context7.com/mcp` so my recipes can look up current library docs.” | Initially stopped at HTTP 405. After repair, treated the page-fetch failure as recoverable, searched and inspected provider sources, verified the endpoint and API-key rail, and created a native setup proposal. | Before: `09393836-1736-452d-95ed-bdd106b8dbc5`; intermediate: `c643bda0-0897-4f70-a2ec-bb29db76371e`; after: `181ad5c6-07f9-4b67-b9b1-9bd05a17197b` |
| Documented no-auth remote MCP | “Connect Clerk's official MCP using `https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server` so recipes can reference current Clerk SDK guidance.” | Inspected provider docs, completed live MCP initialization/tool discovery, and created a native no-auth setup proposal. | Chat `6f166918-5d07-4c7e-b000-6c12d6f35827` |
| User-supplied OpenAPI JSON | “Connect the Swagger Petstore API from `https://petstore3.swagger.io/api/v3/openapi.json` so I can test a daily inventory recipe.” | Correctly rejected the document because it declares multiple auth schemes outside Springroll's current bearer/header-key subset. No malformed connector was created. | Chat `f9bff54c-6f20-4674-873f-64b2a09e9577` |
| Already-connected local MCP | “Connect Microsoft Clarity so I can get a weekly summary of rage clicks and dead clicks.” | Correctly recognized the existing connection and its three read-only tools. Recipe continuation still asked a redundant “if you'd like” question. | Chat `e562f496-494f-4aaa-8aff-d5d349920405` |

## Repairs made

- Added a bounded public connector-source search capability to the `connection.create` tool pack. Registry misses now continue through official provider MCP/API/OpenAPI/repository discovery without requiring the user to research a URL.
- Host policy now forces inspection of an exact provider-owned result after public discovery. Search results alone can never authorize a proposal.
- Host policy distinguishes recoverable registry misses from hard blockers such as an unregistered Gmail OAuth client.
- Raw MCP endpoints that reject ordinary page fetches now return an explanatory, recoverable result instead of an opaque tool failure.
- The compact connection catalog now includes `installed` and `removable`, and creation chats can create a reconnect/setup proposal for a prepared custom manifest.
- The Connections grid now presents prepared custom connectors as “Setup required” with a working Connect action instead of a disabled OAuth dead end.

## Remaining checks

- Replay the full matrix by clicking through the rendered UI once an in-app browser is available; capture review-card, credential-form, OAuth-redirect, error, and accessibility states.
- Accept a disposable no-auth connector and a disposable API-key connector to verify persistence, live discovery, disconnect/reconnect, and removal ceremonies. Do not use production credentials.
- Exercise a new provider-owned local npm MCP from a clean state, including package/repository verification and installation failure recovery.
- Reduce evidence-loop cost. The successful raw Context7 replay used 58,484 tokens because the model tried two insufficient sources before the repository README. The host remained safe, but provider-source ranking and evidence compaction need optimization.
- Continue directly into recipe creation when the original prompt already contains an unambiguous recipe intent; only ask for genuinely missing project/account/schedule details.

## Regression coverage

Focused tests cover the public-source tool boundary, compact prepared-manifest state, resuming a not-yet-installed custom connector, forced search after a recoverable registry miss, forced exact-source inspection after search, and preservation of hard OAuth-registration blockers. TypeScript build and focused application/policy suites pass.

## Free no-auth connector slice

Run on 2026-08-08 after the initial discovery repairs. These tests accepted disposable connections, completed live discovery and a real read-only call, verified that no recipes depended on them, and then removed them. No credentials were created or requested.

| Candidate | Official evidence | End-user result | Live verification |
| --- | --- | --- | --- |
| Microsoft Learn MCP | [Microsoft Learn MCP overview](https://learn.microsoft.com/en-us/training/support/mcp), documenting `https://learn.microsoft.com/api/mcp`, no authentication, and no charge | One prompt created a provider-verified no-auth review card with three read-only tools. One acceptance connected immediately. | `microsoft_docs_search` returned the MCP release-notes source. Setup chat `7b8a3f15-e03a-4327-ad57-6189cb712505`; call chat `491ae717-4485-4a21-a73c-12d407a9be56`. |
| Cloudflare Documentation MCP | [Cloudflare's MCP repository](https://github.com/cloudflare/mcp-server-cloudflare), listing `https://docs.mcp.cloudflare.com/mcp` | One prompt created a provider-verified no-auth review card with two read-only tools. One acceptance connected immediately. | `search_cloudflare_documentation` returned official Workflows retry documentation. Setup chat `d1ec8e16-9ea3-4d9f-a475-a9012ad0413c`; call chat `5f1fdc20-2328-49d0-8bf6-bbe1177799ce`. |
| Frankfurter OpenAPI | [Frankfurter docs](https://frankfurter.dev/) and [official OpenAPI JSON](https://api.frankfurter.dev/v1/openapi.json), requiring no key | Before repair, the assistant asked for redundant confirmation and then guessed probe names in a long failed loop. After repair, one prompt produced an OpenAPI-verified card with five read-only tools; acceptance ran the safe probe and connected. | `get__latest` returned EUR/USD for the latest working day. Failed chat `7a56c22f-6a27-47b6-bb16-881412285e59`; repaired setup `7b3b9cc4-8f15-49d6-8a19-21a8da5c11a1`; call `86de19c0-16f9-4805-b50e-e88de6c84cfe`. |
| Open-Meteo OpenAPI | [Open-Meteo docs](https://open-meteo.com/en/docs) and its provider-owned GitHub YAML spec | Safely stopped. Springroll requires OpenAPI JSON on the provider domain, while the available official spec is YAML in the provider's GitHub repository. Two corrected attempts returned bounded `invalid_input`; no proposal or connector was created. | Blocked before setup. Chat `6399daa4-3f45-426c-aaaa-9b72ee337da3`. |

### Repairs from this slice

- OpenAPI JSON inspection now forces host discovery before proposal, so the model receives exact operation names, schemas, server, authentication, and probe inputs instead of guessing.
- Proposal-time `TypeError` validation becomes a bounded `invalid_input` tool result instead of an opaque red tool error. Existing two-step rejection policy can therefore stop repeated bad proposals cleanly.
- The assistant is told that the native review card is the confirmation surface and should not ask for a redundant conversational confirmation first.
- General chat now has direct read-only connection discovery, description, and call capabilities. This fixed the case where an explicit “use Microsoft Learn” request searched Springroll integration research instead of calling the already-connected tool.

### Remaining friction

- The successful Frankfurter setup still consumed 29,202 model tokens; Microsoft Learn setup used 10,312 and Cloudflare setup used 11,608. Simple instructed no-auth setup should be closer to the latter two.
- Connection-tool search missed “latest EUR USD exchange rate” even though Frankfurter was connected; the assistant recovered by describing that exact connector, but ranking should include connection identity and semantic variants.
- Supporting provider-owned GitHub OpenAPI YAML requires an explicit evidence-chain design: YAML parsing alone is easy, but Springroll must safely establish that the provider controls the repository rather than weakening same-provider verification.
- Visual click-through remains unverified because the configured browser skill package was unavailable in this session.

## Second free/no-auth connector slice

Run on 2026-08-08 with four additional provider-operated connectors. Every successful connector was accepted, exercised with a live call, checked for dependent recipes, and removed. No credential, account, or production data was used.

| Candidate | Official evidence | End-user result | Live verification |
| --- | --- | --- | --- |
| AWS Marketplace MCP | [AWS Marketplace MCP documentation](https://docs.aws.amazon.com/marketplace/latest/developerguide/marketplace-mcp-server.html), listing the Streamable HTTP endpoint and no authentication | One prompt inspected AWS documentation and produced a native review card. Acceptance discovered six tools with five read, one write, and no destructive effects. | `search_aws_marketplace_solutions` returned Grafana Cloud Kubernetes Monitoring and IBM Kubecost Enterprise. Setup chat `ed71982b-5bdd-480e-bd1a-6163622697a7`; call `04dea80b-fbe2-4ae6-aac3-1833200be816`. |
| Frankfurter MCP | [Frankfurter MCP instructions](https://frankfurter.dev/mcp/), explicitly requiring no key or registration | One prompt produced a review card; acceptance discovered `convert`, `get_rates`, and `list_currencies` as read-only tools. | `convert` returned 86.61 EUR for 100 USD. Setup chat `72b5cbb6-695d-43ad-b602-daa8c1beb9c7`; call `b663a1a4-51ac-4bdc-8223-08b360ef6f35`. |
| Shopify Dev MCP | [Shopify AI Toolkit instructions](https://shopify.dev/docs/apps/build/ai-toolkit), documenting `npx -y @shopify/dev-mcp@latest` and no authentication | Initially stopped because the rendered HTML yielded no package evidence, then failed because npm publishes no source repository. After repair, the unchanged prompt followed Shopify's Markdown alternate, verified the exact scoped package from official docs, pinned npm version 1.14.4, installed it, and discovered five tools. | `learn_shopify_api` returned current Polaris App Home guidance and a provider conversation ID. Initial `cf3d07af-0bff-41f8-b08b-627f497a154f`; intermediate `24ab9d61-2089-4c82-83e3-449379b87b33`; repaired setup `6351f3bb-90a5-40a5-bdeb-89ecbb8cfdd0`; call `f92d0b86-919d-4ec2-b494-c8e01ee6825b`. |
| U.S. National Weather Service OpenAPI | [NWS API documentation](https://www.weather.gov/documentation/services-web-api) and [official OpenAPI JSON](https://api.weather.gov/openapi.json), documenting free open data and identifying User-Agent requests | Initially rejected the User-Agent/API-Key alternatives, then a valid path/query parameter collision. After repair, one prompt produced a credential-free card with 69 read-only operations and a safe `alerts_types` probe. | `alerts_active_count` returned 158 active alerts during the test. Initial `05a27cab-1a22-4b9c-90e5-6e7070191f17`; collision replay `2e35dccc-d403-4d0e-ba9e-78cee8824930`; repaired setup `edae76a5-000b-4875-8186-01a911cb7267`; call `d51c0184-2449-461d-823c-eab87b16aa8d`. |

### Repairs from this slice

- An official page that yields no usable connector configuration now triggers one bounded public-source search instead of asking the user to find another URL.
- Truncated HTML documentation can follow a same-origin `text/markdown` alternate. This recovered Shopify's exact package and authentication instructions without trusting search snippets as final evidence.
- A repositoryless local npm package can be proposed only when official provider documentation names the exact provider-scoped package, npm verifies and pins it, and npm itself publishes no repository. Existing repository-match checks remain mandatory when repository metadata exists.
- General chat now has the effect-appropriate connected write-call wrapper. After connection-tool search finds a match, host policy forces exact tool description so the model sees the authoritative schema and effect before invocation.
- OpenAPI security alternatives can treat a standalone, documented open/free `User-Agent` identification scheme as credential-free. The same scheme ANDed with a real key remains rejected. OpenAPI calls send a stable Springroll User-Agent.
- Same-spelled OpenAPI parameters in different HTTP locations are exposed as unambiguous model inputs such as `path_type` and `query_type`, while requests preserve the provider's original parameter names.
- OpenAPI discovery now recommends a safe GET verification operation with no documented inputs when one exists.

### Remaining friction from this slice

- Large provider schemas and results are still expensive. Shopify's repaired setup used 12,030 tokens and its first live call used 32,153; NWS setup used 30,933. The host bounds stored results, but tool-description selection and structured result projection need further compaction.
- Shopify omits MCP read-only annotations, so Springroll conservatively classifies all five tools as write. The explicit user-requested documentation call succeeds through the ordinary write wrapper, but the product should eventually offer a reviewable per-tool effect override or encourage providers to publish annotations.
- The first AWS live call guessed a singular `query` field before recovering through schema inspection. Host policy now forces description after search matches, but direct exact-tool requests that skip search can still rely on model discipline.
- Visual click-through remains open because the configured in-app browser skill package is unavailable.

## Configuration-first MCP and documentation-led API slice

Run on 2026-08-08 after separating the two authoring models. MCP import is now a deterministic host path; ordinary APIs may be summarized from documentation into a small saved adapter without requiring OpenAPI. Both disposable connections were accepted, tested live, and removed.

| Candidate | Input | Result |
| --- | --- | --- |
| Frankfurter MCP | Standard single-server `mcpServers` JSON containing `https://mcp.frankfurter.dev/` and no authentication | Host import created the manifest without a model or documentation-research loop. Acceptance initialized MCP and `tools/list` discovered the three live read tools. The connector was then removed. |
| [Dog CEO API](https://dog.ceo/dog-api/documentation/) | “Create a small API integration named Dog Images for this goal: fetch one random dog image,” plus the ordinary documentation URL | The unchanged final replay inspected the supplied overview, refused to accept the proposed path until the exact random-image reference was inspected, saved only `GET /breeds/image/random`, rendered a native review card, and used that exact read as the safe acceptance probe. The probe succeeded and the connector was removed. Chat `7272e1ed-7451-40a7-b2fb-f6e4765d68b6`; 22,678 total model tokens. |

### Product boundary implemented

- Remote MCP accepts an exact URL or common one-server client JSON (`mcpServers`, `servers`, or a direct remote object), strips configuration down to endpoint/name/authentication header, and never sends the configuration through model research.
- Embedded MCP credential values are rejected. Environment-style placeholders may identify an authentication header; the actual value remains in the host credential ceremony.
- MCP connection success remains `initialize` plus `tools/list`; documentation never authors its tool contract.
- Ordinary API documentation can produce a reviewed `http-api` manifest containing at most 20 goal-relevant operations. Each operation saves a closed input schema, exact method/path mapping, and conservative effect.
- Documented API setup requires an explicit harmless read probe, confirms the API host and every saved method/path appear in the inspected documentation, injects credentials host-side, refuses redirects, bounds responses to 1 MB, and redacts secrets.
- Accepted API adapters run only from the saved manifest during later recipes; they do not reread documentation or ask a model to reconstruct requests.

## Recovery and OpenAPI compaction follow-up

Run on 2026-08-09 against the remaining integration-experience gaps.

- A failed local npm MCP start now preserves the prepared connector ID and a secret-free, retryable ceremony in the durable chat workflow. Refreshing no longer degrades the failure to generic setup state, and the rendered action explicitly says `Retry local setup`. A setup-boundary regression reproduces the failed start and successful second attempt without depending on the public npm network.
- OpenAPI discovery no longer sends every full operation schema to the chat model. It returns up to 16 compact operation summaries plus the host-selected verification operation when that operation falls outside the first page. The exact verification input remains intact, and proposal acceptance re-fetches and validates the authoritative OpenAPI document, so compaction does not move authority into model context.
- A 40-operation regression fixture reduced the discovery result to 17 compact summaries under 10,000 serialized characters while retaining the 40th operation used by the safe probe.
- Visual click-through remains open: the in-app browser was listed on 2026-08-09, but browser selection returned no available runtime and its packaged troubleshooting reference pointed at a removed plugin version. No visual-pass claim was made.

## Known-unavailable OAuth follow-up

Run on 2026-08-09 using the exact prompt “I want to connect to gmail.” The
original experience treated a cataloged but unavailable connector as both
reconnectable and researchable. It made three tool calls, displayed a generic
connection-action failure followed by a “More information needed” card, asked
the user for documentation or an MCP URL, and exposed an endpoint that could
not be used. Chat `17feba39-963c-43a3-811b-33fa453cc2ae` used 14,573 tokens at
an estimated $0.019020.

The repaired path derives the outcome from generic connector metadata rather
than a Gmail-specific workflow. Catalog entries with no actionable variant are
reported as `coming_soon`; a query is narrowed to the user's named target; and
`setup: unavailable`, `oauthReady: false`, plus a host-authored blocker ends the
tool loop. A direct research outcome also carries `userAction: none`, so the UI
cannot render documentation, credential, or alternate-server recovery actions
for an app-release prerequisite.

The unchanged replay made one filtered catalog call and ended with: “Gmail
sign-in is not available in this build; this is a Springroll release
prerequisite and there is nothing the user needs to configure.” Chat
`b309134c-78aa-4298-b33a-da121f791616` used 4,075 tokens at an estimated
$0.005442—a 72% token reduction and 71% estimated-cost reduction, with no
reconnect, research, endpoint disclosure, or false user action.

This is the intended agent/host split: the model owns provider research,
proposal completion, safe-test selection, and useful authentication guidance;
the host supplies authoritative capability state, validation, secret handling,
and execution. Host policy intervenes only when a hard fact makes further model
work misleading or unsafe.

## Third model-led sample from minimal inputs

Run on 2026-08-09 through the durable `connection.create` chat boundary. The
inputs were deliberately small: an official MCP instructions URL, a provider
name plus goal, ordinary API docs plus goal, and an API provider plus goal. The
model researched and authored proposals; Springroll validated evidence,
credentials, schemas, probes, persistence, and live execution.

| Candidate | Minimal input and result | Usage and verification |
| --- | --- | --- |
| [DeepWiki MCP](https://docs.devin.ai/work-with-devin/deepwiki-mcp) | Official instructions plus “answer questions about public GitHub repositories” produced the documented no-auth remote endpoint. Acceptance initialized MCP and discovered `ask_question`, `read_wiki_contents`, and `read_wiki_structure`. | Setup chat `2c05c08b-d576-484d-8ae9-92795912e629`: 11,091 tokens, $0.014668 estimated. The first live call exposed a description-ranking bug and ended failed despite a successful retry (`ecdd36b9-5c4d-48e9-af38-9818fdfe279a`, 13,356 tokens). After repair, `read_wiki_structure` was described exactly and called once with its authoritative schema (`576119a4-b5f4-4167-8666-0541caaf73ec`, 12,830 tokens, $0.017247). |
| [USGS Earthquake API](https://earthquake.usgs.gov/fdsnws/event/1/) | Provider name plus a goal to summarize magnitude 5+ earthquakes from the previous day produced one credential-free `GET /query` adapter with only the needed time, magnitude, and format inputs. The host's harmless probe passed on acceptance. | Chat `29566e80-4bd7-4969-b6e9-c20f4a5995a0`: 27,935 tokens, $0.036418 estimated. |
| [Open Library API](https://openlibrary.org/developers/api) | Ordinary documentation plus a title-and-author book-search goal followed the provider's Search API reference and produced one read-only `GET /search.json` operation. One host validation response corrected omitted parameter mappings; acceptance probe passed. | Chat `ac182c65-299a-40ce-a61b-c75b9e3b461b`: 34,628 tokens, $0.044886 estimated. |
| [NASA APOD](https://api.nasa.gov/) | Provider plus APOD goal produced one read-only `GET /planetary/apod` adapter, identified `api_key` as a query credential, linked NASA's key signup, and explicitly refused `DEMO_KEY`. The native card appeared before any credential was obtained. Preparing it moved to `awaiting_api_key` with `credentialConfigured: false`; no key was created, entered, or saved. | Final Connections-flow chat `03fedd89-74b3-4540-b87f-f314572ca38c`: 39,944 tokens, $0.051881 estimated. Earlier attempts exposed missing query-key support and insufficient provider-source following. |

All four disposable manifests were checked for recipe references and removed at
the end. DeepWiki received a real live call; the USGS and Open Library
acceptance probes made real reads; NASA stopped correctly at the secure key
boundary.

### Repairs from this sample

- Connected-tool description now ranks all query terms instead of requiring one
  literal phrase. DeepWiki's schema was therefore available before its live
  call, eliminating guessed inputs and the failed-turn/successful-call split.
- Ready-proposal guidance says the native card is already in the chat and names
  the action to take there; it no longer sends the user to another page.
- Documented APIs support provider-documented query API keys. The manifest
  requires exactly one header or query injection rail, forbids that secret field
  from model-visible operation inputs, injects it host-side, and redacts it from
  results and errors.
- API operations, credential rails, and key-creation links now require
  provider-owned inspected evidence. Third-party API mirrors cannot authorize a
  proposal, and policy forces a new provider source after discovery instead of
  accepting a repeated landing page.
- Application-capability search now forces activation of the chosen application
  tool and states that application-tool names are never connector IDs. This
  addresses a plain general-chat replay that misrouted
  `springroll_research_connection` through a connected-tool wrapper and exhausted
  its turn (`a2678d49-0fa2-4a26-98d6-c0602cd21925`, 27,130 tokens).

### Remaining friction from this sample

- Documentation-led API setup is correct but still too expensive: USGS used
  27,935 tokens, Open Library 34,628, and NASA 39,944. Older search and inspection
  results should be compacted before proposal, and explicit ordinary-API prompts
  should skip the MCP registry lane.
- MCP servers that omit tool annotations remain conservatively write-classified;
  all three DeepWiki tools exhibit this provider limitation.
- The durable HTTP boundary is verified, but visual card, keyboard, and
  accessibility behavior still awaits a working in-app browser runtime.

## Shared compact-search and focused-read replay

Implemented on 2026-08-09 for both interactive chat and scheduled runs. Search
now returns up to five ranked URLs with 800-character summaries. Exact reads
carry a model-selected focus and default 4,000-character bound, use Exa Contents
when a key is configured, and fall back to focused direct extraction. Older
search and read evidence is compacted before later model steps. Connector
acceptance retains a separate direct provider fetch as its authority boundary.

The first live prompt, “I want to connect to the Open Library API,” exposed that
the free Exa MCP's formatted text was not recognized as a result catalog. It
used 39,574 input tokens over seven tool steps and stopped before a proposal.
After adding formatted-result parsing, the source search returned one compact
ranked lead instead of the multi-page discovery blob. A scoped replay asking
only for the public Book Search endpoint needed one focused page read and made a
valid one-operation review card in five tool steps: chat
`c06c5110-3d24-45a4-a004-4a7e2a741e17`, 21,531 input tokens and $0.030060
estimated.

The exact original prompt was then replayed as chat
`87bf2d01-34b4-4973-b37a-515fe20d1076`. Search stayed compact and all reads were
focused, but the model chose eleven steps: it investigated an HTML OpenAPI
sandbox, made one evidence-incomplete proposal, followed the exact endpoint
reference, and corrected one schema validation issue. It finished with a valid
review card but used 65,860 input tokens and $0.087337 estimated. This isolates
the remaining connector cost: discovery payload size is now bounded, while
ambiguous integration prompts can still be expensive because every additional
model turn re-ingests the active tool schemas and recent evidence. Further cost
work should target fewer research/proposal turns and narrower activated schema
packs, not larger search-result settings.
