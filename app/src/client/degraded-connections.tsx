import { Link } from "react-router-dom";
import type {
  DegradedConnectionDto,
  TaskProposalOutcomeDto,
} from "../shared.ts";

export function degradedConnectionMessage(
  connection: DegradedConnectionDto,
  historical = false,
): string {
  return historical
    ? `${connection.name} was connected but unreachable when this proposal was created. Review its current connection status before reconnecting.`
    : `${connection.name} is connected but unreachable. Review the connection to reconnect.`;
}

export interface DegradedConnectionPolicy {
  readonly connections: readonly DegradedConnectionDto[];
  readonly connectionNeedsAttention: boolean;
  readonly showUnavailableDetails: boolean;
  readonly showIntegrationSetup: boolean;
}

export function taskProposalDegradedConnectionPolicy(
  outcome: TaskProposalOutcomeDto,
): DegradedConnectionPolicy {
  const connections = outcome.degradedConnections ?? [];
  if (outcome.status !== "needs_integration") {
    return {
      connections,
      connectionNeedsAttention: false,
      showUnavailableDetails: true,
      showIntegrationSetup: false,
    };
  }
  const relevantIds = new Set(outcome.degradedConnectionIds ?? []);
  const relevantConnections = connections.filter((connection) =>
    relevantIds.has(connection.id),
  );
  const connectionNeedsAttention = relevantConnections.length > 0;
  return {
    connections: connectionNeedsAttention ? relevantConnections : connections,
    connectionNeedsAttention,
    showUnavailableDetails: !connectionNeedsAttention,
    showIntegrationSetup: !connectionNeedsAttention,
  };
}

export function DegradedConnectionsNotice({
  connections,
  historical = false,
}: {
  readonly connections: readonly DegradedConnectionDto[];
  readonly historical?: boolean;
}) {
  if (connections.length === 0) return null;
  return (
    <aside className="supported-alternative">
      {connections.map((connection) => (
        <p key={connection.id}>
          {degradedConnectionMessage(connection, historical)}{" "}
          <Link to={`/connections/${encodeURIComponent(connection.id)}`}>
            Review connection
          </Link>
        </p>
      ))}
    </aside>
  );
}
