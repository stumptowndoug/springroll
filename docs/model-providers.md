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
| Mistral AI | API key | Metered | AI SDK |
| Groq | API key | Metered | AI SDK |
| DeepSeek | API key | Metered | AI SDK |
| Cohere | API key | Metered | AI SDK |
| Codex | Managed ChatGPT browser sign-in | Subscription | Codex app server, experimental |

API keys are verified against a read-only provider model endpoint before they
are saved to macOS Keychain. The model catalog comes from models.dev, and each
maintained AI SDK adapter is responsible for the provider's generation
protocol.

Codex gets its own isolated application data directory and sign-in. Recipe
tools are exposed through app server's experimental client-executed dynamic
tools, keeping connector credentials and execution in the Springroll host.
Codex is intentionally absent from ordinary chat and distiller model pickers.

## Current Codex constraints

- Local recipe runs only; hosted execution is not implemented.
- The configured turn limit is sent as guidance, not enforced by app server.
- Cost limits do not apply to subscription billing.
- Token usage is recorded when app server reports it.
- Tools requiring per-call approval are rejected until continuation support is
  implemented.
- The integration uses an experimental app-server API and should remain labeled
  experimental until it survives live scheduled-run acceptance testing.

## What was considered

- The [AI SDK provider catalog](https://ai-sdk.dev/providers/ai-sdk-providers)
  supports additional adapters, including cloud platforms. Azure, Amazon
  Bedrock, and Google Vertex AI are deferred because their IAM and deployment
  setup is materially different from the simple API-key connection flow.
- The official [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk),
  [authentication](https://learn.chatgpt.com/docs/auth), and
  [app-server](https://learn.chatgpt.com/docs/app-server) documentation support
  embedded, managed ChatGPT authentication and client-executed tools.
- Anthropic documents Claude subscription OAuth for Anthropic products. A
  third-party application should use an API key or supported cloud provider, so
  Springroll does not present a Claude subscription sign-in.
- The [GitHub Copilot SDK authentication flow](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate)
  can use a person's Copilot subscription through GitHub OAuth. It is the next
  subscription candidate after Codex.
- Gemini CLI supports local Google sign-in and cached credentials. It remains a
  spike until its package boundary, terms, and unattended scheduled-run behavior
  are verified.
