import { sql } from "drizzle-orm";
import type { ModelCallContextKind } from "../assistant.ts";
import type { AppDatabase } from "./database.ts";

export interface SpendSummary {
  readonly contextKind?: ModelCallContextKind;
  readonly calls: {
    readonly total: number;
    readonly started: number;
    readonly succeeded: number;
    readonly failed: number;
    readonly cancelled: number;
  };
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly reasoning: number;
    readonly cachedInput: number;
    readonly total: number;
  };
  readonly costUsdMicros: {
    readonly recorded: number;
    readonly actual: number;
    readonly estimated: number;
  };
  readonly webSearchRequests: number;
  readonly providerToolCalls: number;
}

interface SpendAggregateRow {
  readonly total_calls: number;
  readonly started_calls: number;
  readonly succeeded_calls: number;
  readonly failed_calls: number;
  readonly cancelled_calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly reasoning_tokens: number;
  readonly cached_input_tokens: number;
  readonly total_tokens: number;
  readonly recorded_cost: number;
  readonly actual_cost: number;
  readonly estimated_cost: number;
  readonly web_search_requests: number;
  readonly provider_tool_calls: number;
}

/**
 * Reads one provider-neutral spend view across interactive model-call rows and
 * scheduled-run events. A run-specific model-call ledger wins when present;
 * older runs fall back to their event stream, then to the projected run row.
 */
export class SqliteSpendQuery {
  constructor(private readonly db: AppDatabase) {}

  summary(contextKind?: ModelCallContextKind): SpendSummary {
    const filter = contextKind ?? null;
    const [row] = this.db.all<SpendAggregateRow>(sql`
      with canonical_run_ids as (
        select distinct context_id as run_id
        from model_calls
        where context_kind = 'run'
      ),
      run_turns as (
        select
          run_id,
          json_extract(payload, '$.turnId') as turn_id,
          max(
            case json_extract(payload, '$.phase')
              when 'failed' then 3
              when 'completed' then 2
              else 1
            end
          ) as terminal_state
        from run_events
        where type = 'model_turn'
          and not exists (
            select 1 from canonical_run_ids
            where canonical_run_ids.run_id = run_events.run_id
          )
        group by run_id, json_extract(payload, '$.turnId')
      ),
      spend_entries as (
        select
          context_kind,
          1 as total_calls,
          case when status = 'started' then 1 else 0 end as started_calls,
          case when status = 'succeeded' then 1 else 0 end as succeeded_calls,
          case when status = 'failed' then 1 else 0 end as failed_calls,
          case when status = 'cancelled' then 1 else 0 end as cancelled_calls,
          coalesce(input_tokens, 0) as input_tokens,
          coalesce(output_tokens, 0) as output_tokens,
          coalesce(reasoning_tokens, 0) as reasoning_tokens,
          coalesce(cached_input_tokens, 0) as cached_input_tokens,
          coalesce(total_tokens, 0) as total_tokens,
          coalesce(cost_usd_micros, 0) as recorded_cost,
          coalesce(actual_cost_usd_micros, 0) as actual_cost,
          coalesce(estimated_cost_usd_micros, 0) as estimated_cost,
          coalesce(web_search_requests, 0) as web_search_requests,
          coalesce(provider_tool_calls, 0) as provider_tool_calls
        from model_calls

        union all

        select
          'run' as context_kind,
          1 as total_calls,
          case when terminal_state = 1 then 1 else 0 end as started_calls,
          case when terminal_state = 2 then 1 else 0 end as succeeded_calls,
          case when terminal_state = 3 then 1 else 0 end as failed_calls,
          0 as cancelled_calls,
          0 as input_tokens,
          0 as output_tokens,
          0 as reasoning_tokens,
          0 as cached_input_tokens,
          0 as total_tokens,
          0 as recorded_cost,
          0 as actual_cost,
          0 as estimated_cost,
          0 as web_search_requests,
          0 as provider_tool_calls
        from run_turns

        union all

        select
          'run' as context_kind,
          0 as total_calls,
          0 as started_calls,
          0 as succeeded_calls,
          0 as failed_calls,
          0 as cancelled_calls,
          coalesce(cast(json_extract(payload, '$.inputTokens') as integer), 0) as input_tokens,
          coalesce(cast(json_extract(payload, '$.outputTokens') as integer), 0) as output_tokens,
          coalesce(cast(json_extract(payload, '$.reasoningTokens') as integer), 0) as reasoning_tokens,
          coalesce(cast(json_extract(payload, '$.cachedInputTokens') as integer), 0) as cached_input_tokens,
          coalesce(cast(json_extract(payload, '$.totalTokens') as integer), 0) as total_tokens,
          coalesce(cast(json_extract(payload, '$.costUsdMicros') as integer), 0) as recorded_cost,
          coalesce(cast(json_extract(payload, '$.actualCostUsdMicros') as integer), 0) as actual_cost,
          coalesce(cast(json_extract(payload, '$.estimatedCostUsdMicros') as integer), 0) as estimated_cost,
          coalesce(cast(json_extract(payload, '$.webSearchRequests') as integer), 0) as web_search_requests,
          coalesce(cast(json_extract(payload, '$.providerToolCalls') as integer), 0) as provider_tool_calls
        from run_events
        where type = 'usage'
          and not exists (
            select 1 from canonical_run_ids
            where canonical_run_ids.run_id = run_events.run_id
          )

        union all

        select
          'run' as context_kind,
          1 as total_calls,
          case when status in ('claimed', 'running', 'waiting_for_approval') then 1 else 0 end as started_calls,
          case when status = 'succeeded' then 1 else 0 end as succeeded_calls,
          case when status = 'failed' then 1 else 0 end as failed_calls,
          0 as cancelled_calls,
          0 as input_tokens,
          0 as output_tokens,
          0 as reasoning_tokens,
          0 as cached_input_tokens,
          0 as total_tokens,
          0 as recorded_cost,
          0 as actual_cost,
          0 as estimated_cost,
          0 as web_search_requests,
          0 as provider_tool_calls
        from runs
        where not exists (
            select 1 from canonical_run_ids
            where canonical_run_ids.run_id = runs.id
          )
          and not exists (
            select 1 from run_events
            where run_events.run_id = runs.id
              and run_events.type = 'model_turn'
          )

        union all

        select
          'run' as context_kind,
          0 as total_calls,
          0 as started_calls,
          0 as succeeded_calls,
          0 as failed_calls,
          0 as cancelled_calls,
          coalesce(input_tokens, 0) as input_tokens,
          coalesce(output_tokens, 0) as output_tokens,
          coalesce(reasoning_tokens, 0) as reasoning_tokens,
          coalesce(cached_input_tokens, 0) as cached_input_tokens,
          coalesce(total_tokens, 0) as total_tokens,
          coalesce(cost_usd_micros, 0) as recorded_cost,
          coalesce(actual_cost_usd_micros, 0) as actual_cost,
          coalesce(estimated_cost_usd_micros, 0) as estimated_cost,
          coalesce(web_search_requests, 0) as web_search_requests,
          0 as provider_tool_calls
        from runs
        where not exists (
            select 1 from canonical_run_ids
            where canonical_run_ids.run_id = runs.id
          )
          and not exists (
            select 1 from run_events
            where run_events.run_id = runs.id
              and run_events.type = 'usage'
          )
      )
      select
        coalesce(sum(total_calls), 0) as total_calls,
        coalesce(sum(started_calls), 0) as started_calls,
        coalesce(sum(succeeded_calls), 0) as succeeded_calls,
        coalesce(sum(failed_calls), 0) as failed_calls,
        coalesce(sum(cancelled_calls), 0) as cancelled_calls,
        coalesce(sum(input_tokens), 0) as input_tokens,
        coalesce(sum(output_tokens), 0) as output_tokens,
        coalesce(sum(reasoning_tokens), 0) as reasoning_tokens,
        coalesce(sum(cached_input_tokens), 0) as cached_input_tokens,
        coalesce(sum(total_tokens), 0) as total_tokens,
        coalesce(sum(recorded_cost), 0) as recorded_cost,
        coalesce(sum(actual_cost), 0) as actual_cost,
        coalesce(sum(estimated_cost), 0) as estimated_cost,
        coalesce(sum(web_search_requests), 0) as web_search_requests,
        coalesce(sum(provider_tool_calls), 0) as provider_tool_calls
      from spend_entries
      where (${filter} is null or context_kind = ${filter})
    `);

    return {
      ...(contextKind ? { contextKind } : undefined),
      calls: {
        total: row?.total_calls ?? 0,
        started: row?.started_calls ?? 0,
        succeeded: row?.succeeded_calls ?? 0,
        failed: row?.failed_calls ?? 0,
        cancelled: row?.cancelled_calls ?? 0,
      },
      tokens: {
        input: row?.input_tokens ?? 0,
        output: row?.output_tokens ?? 0,
        reasoning: row?.reasoning_tokens ?? 0,
        cachedInput: row?.cached_input_tokens ?? 0,
        total: row?.total_tokens ?? 0,
      },
      costUsdMicros: {
        recorded: row?.recorded_cost ?? 0,
        actual: row?.actual_cost ?? 0,
        estimated: row?.estimated_cost ?? 0,
      },
      webSearchRequests: row?.web_search_requests ?? 0,
      providerToolCalls: row?.provider_tool_calls ?? 0,
    };
  }
}
