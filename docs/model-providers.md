# Model providers and coding subscriptions

Springroll deliberately has two model-runtime shapes. Ordinary model APIs use
Vercel AI SDK provider adapters inside Springroll's existing agent loop. Coding
subscriptions use a provider-owned agent runtime and are integrated behind the
same Springroll `AgentRunner` boundary.

## Available now

| Provider | Authentication | Billing shown by Springroll | Runtime |
| --- | --- | --- | --- |
| OpenRouter | API key | Metered | AI SDK |
| OpenAI | API key | Metered | AI SDK |
| Anthropic | API key | Metered | AI SDK |
| Google AI | API key | Metered | AI SDK |
| xAI | API key | Metered | AI SDK |
| Groq | API key | Metered | AI SDK |
| Claude | Managed Claude browser sign-in | Subscription | Claude Agent SDK, experimental |
| Codex | Managed ChatGPT browser sign-in | Subscription | Codex app server, experimental |

API keys are verified against a read-only provider model endpoint before they
are saved to macOS Keychain. The model catalog comes from models.dev, and each
maintained AI SDK adapter is responsible for the provider's generation
protocol.

Mistral, DeepSeek, and Cohere models remain available through OpenRouter. They
are not shown as separate direct-key connections because OpenRouter already
covers those model families with one account.

Codex gets its own isolated application data directory and sign-in. Recipe
tools are exposed through app server's experimental client-executed dynamic
tools, keeping connector credentials and execution in the Springroll host.
Coding subscriptions are intentionally absent from ordinary chat and distiller
model pickers.
Settings keeps the chat default separate from the recipe default so a recipe
can use a connected coding subscription without routing ordinary conversation
through that runtime.

Claude uses the official Agent SDK and its bundled Claude Code executable, so
users do not install a CLI or configure an environment variable. Springroll
keeps a separate Claude configuration directory, launches Claude's normal
browser sign-in, disables built-in coding tools, and exposes only the recipe's
pinned Springroll tools through an in-process MCP server. Claude is also
available only in recipe model pickers.

## Current Codex constraints

- Local recipe runs only; hosted execution is not implemented.
- The configured turn limit is sent as guidance, not enforced by app server.
- Cost limits do not apply to subscription billing.
- Token usage is recorded when app server reports it.
- Tools requiring per-call approval are rejected until continuation support is
  implemented.
- The integration uses an experimental app-server API and should remain labeled
  experimental until it survives live scheduled-run acceptance testing.

## Current Claude constraints

- Local recipe runs only; hosted execution is not implemented.
- The configured turn limit is enforced by Agent SDK's `maxTurns` option.
- Cost limits do not apply to subscription billing.
- Token, cache, and reasoning usage are recorded when Agent SDK reports them.
- Tools requiring per-call approval are rejected until continuation support is
  implemented.
- Sonnet, Opus, and Haiku use Claude Code's stable model aliases so the bundled
  runtime can resolve the current model available to the signed-in account.

## What was considered

- The [AI SDK provider catalog](https://ai-sdk.dev/providers/ai-sdk-providers)
  supports additional adapters, including cloud platforms. Azure, Amazon
  Bedrock, and Google Vertex AI are deferred because their IAM and deployment
  setup is materially different from the simple API-key connection flow.
- The official [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk),
  [authentication](https://learn.chatgpt.com/docs/auth), and
  [app-server](https://learn.chatgpt.com/docs/app-server) documentation support
  embedded, managed ChatGPT authentication and client-executed tools.
- The official Claude Agent SDK supplies the bundled runtime, in-process MCP
  tools, cancellation, turn limits, account metadata, and normalized usage used
  by Springroll's local recipe runner.
- The [GitHub Copilot SDK authentication flow](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate)
  can use a person's Copilot subscription through GitHub OAuth. It is the next
  subscription candidate after Codex.
- Gemini CLI supports local Google sign-in and cached credentials. It remains a
  spike until its package boundary, terms, and unattended scheduled-run behavior
  are verified.
