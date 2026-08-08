import { describe, expect, test } from "bun:test";
import {
  degradedConnectionMessage,
  matchingDegradedConnections,
} from "../src/client/degraded-connections.tsx";

describe("degraded connection presentation", () => {
  test("explains that an installed connection needs reconnection", () => {
    expect(degradedConnectionMessage({ id: "gmail", name: "Gmail" })).toBe(
      "Gmail is connected but unreachable. Review the connection to reconnect.",
    );
  });

  test("replaces needs-integration only when the degraded connection matches", () => {
    const connections = [
      { id: "gmail", name: "Gmail" },
      { id: "linear", name: "Linear" },
    ];

    expect(matchingDegradedConnections(connections, ["gmail.read"])).toEqual([
      { id: "gmail", name: "Gmail" },
    ]);
    expect(
      matchingDegradedConnections(connections, ["Slack access is needed"]),
    ).toEqual([]);
  });
});
