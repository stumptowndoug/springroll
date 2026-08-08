import { Link } from "react-router-dom";
import type { DegradedConnectionDto } from "../shared.ts";

export function degradedConnectionMessage(
  connection: DegradedConnectionDto,
): string {
  return `${connection.name} is connected but unreachable. Review the connection to reconnect.`;
}

export function matchingDegradedConnections(
  connections: readonly DegradedConnectionDto[],
  hints: readonly (string | undefined)[],
): readonly DegradedConnectionDto[] {
  const text = hints.filter(Boolean).join(" ").toLocaleLowerCase();
  return connections.filter((connection) =>
    [connection.id, connection.name].some((candidate) => {
      const normalized = candidate.trim().toLocaleLowerCase();
      return normalized.length >= 3 && text.includes(normalized);
    }),
  );
}

export function DegradedConnectionsNotice({
  connections,
}: {
  readonly connections: readonly DegradedConnectionDto[];
}) {
  if (connections.length === 0) return null;
  return (
    <aside className="supported-alternative" role="status">
      <span>Connection needs attention</span>
      {connections.map((connection) => (
        <p key={connection.id}>
          {degradedConnectionMessage(connection)}{" "}
          <Link to={`/connections/${encodeURIComponent(connection.id)}`}>
            Review connection
          </Link>
        </p>
      ))}
    </aside>
  );
}
