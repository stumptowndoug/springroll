import { describe, expect, test } from "bun:test";
import {
  degradedConnectionMessage,
  taskProposalDegradedConnectionPolicy,
} from "../src/client/degraded-connections.tsx";

describe("degraded connection presentation", () => {
  test("explains that an installed connection needs reconnection", () => {
    expect(degradedConnectionMessage({ id: "gmail", name: "Gmail" })).toBe(
      "Gmail is connected but unreachable. Review the connection to reconnect.",
    );
    expect(
      degradedConnectionMessage({ id: "gmail", name: "Gmail" }, true),
    ).toBe(
      "Gmail was connected but unreachable when this proposal was created. Review its current connection status before reconnecting.",
    );
  });

  test("gates needs-integration only on server-matched connection ids", () => {
    const base = {
      status: "needs_integration" as const,
      title: "Gmail access is needed",
      explanation: "The model can mention Gmail or Linear here.",
      missingCapability: "gmail.read",
      degradedConnections: [
        { id: "gmail", name: "Gmail" },
        { id: "linear", name: "Linear" },
      ],
    };

    expect(
      taskProposalDegradedConnectionPolicy({
        ...base,
        degradedConnectionIds: ["gmail"],
      }),
    ).toMatchObject({
      connections: [{ id: "gmail", name: "Gmail" }],
      connectionNeedsAttention: true,
      showUnavailableDetails: false,
      showIntegrationSetup: false,
    });
    expect(
      taskProposalDegradedConnectionPolicy({
        ...base,
        degradedConnectionIds: [],
      }),
    ).toMatchObject({
      connectionNeedsAttention: false,
      showUnavailableDetails: true,
      showIntegrationSetup: true,
    });
  });
});
