import { describe, expect, test } from "bun:test";
import {
  connectionToolPolicyMode,
  withConnectionToolPolicy,
} from "../src/connection-tool-policy.ts";

describe("connection tool policy", () => {
  test("defaults to allow and preserves explicit connector choices", () => {
    expect(connectionToolPolicyMode({}, "read", "read")).toBe("allow");
    expect(connectionToolPolicyMode({}, "write", "write")).toBe("allow");
    expect(connectionToolPolicyMode({}, "delete", "destructive")).toBe("allow");

    const config = withConnectionToolPolicy(
      { provider: "fixture" },
      "delete",
      "allow",
    );
    expect(config).toEqual({
      provider: "fixture",
      toolPolicies: { delete: "allow" },
    });
    expect(connectionToolPolicyMode(config, "delete", "destructive")).toBe(
      "allow",
    );
  });
});
