# Execution limits

Settings supplies a model-turn limit and optional cost budget for recipe runs only.
Each run reads current settings when it starts and keeps its snapshot. Recipes do
not currently have per-recipe execution-limit overrides.

Each limit has a dropdown with Off, common values, and Custom. Turn-limit Off is stored as
`maxSteps: 0` and removes the recipe turn-count cap (including turn-count wrap-up).
Cost-limit Off omits the cost target. Custom reveals a number field; selecting
a preset saves it directly. Time/context safeguards and
provider limits still apply, and chat safeguards are unchanged.

Chat does not inherit those settings. Each response gets independent safeguards:
20 model steps, 2,000,000 cumulative input tokens, and a 10-minute active-duration
boundary. These are checked between model steps, not a hard request timeout. Chat
has no user-configured dollar budget today. New messages get fresh allowances;
there is no conversation-wide limit. Chats opened from a recipe or run use the
same chat safeguards, not the associated recipe's budget.

For AI SDK models, the last allowed model step disables tools and requests a final
answer. Model steps are not tool calls: one step can call several tools. The dollar
recipe budget is a target checked between steps using provider-reported cost when available,
otherwise catalog estimates. The final call may exceed the target. Search-provider
charges are not currently included in these model-cost totals.

If the model attempts a disabled tool or returns no final text at a limit, the host
streams and saves a final explanation of the boundary and incomplete work. It never
invents findings. It does not make an extra synthesis call beyond the turn cap or
after the cost, time, or input-token boundary. Recovery synthesis before those
boundaries is bounded to 30 seconds and respects user cancellation. Approval waits
and user cancellation are not converted into successful limit responses.

Recipe AI SDK runs already reserve wrap-up steps and have a host-written partial
report fallback. Chat keeps a corresponding fallback for its independent safeguards.

Subscription runtimes receive the appropriate recipe limit or chat safeguard through their existing
runner interface. Claude uses its SDK's max-turns option and returns an explicit
incomplete response/report if that boundary is reached; Codex currently receives
the limit as instructions rather than a hard host cap. Dollar targets are for
metered models, not subscription quotas. These subscription constraints are unchanged.
