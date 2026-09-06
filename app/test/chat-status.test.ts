import { describe, expect, test } from "bun:test";
import { chatStatusInfo } from "../src/client/chat-status.ts";

describe("chat header status", () => {
  const session = { activeTurnId: null, status: "active" } as const;

  test("distinguishes a stopped response from successful completion", () => {
    expect(
      chatStatusInfo({ session, turns: [{ status: "cancelled" }] }, false),
    ).toEqual({ label: "Stopped", className: "status-quiet" });
    expect(
      chatStatusInfo({ session, turns: [{ status: "completed" }] }, false),
    ).toEqual({ label: "Finished", className: "status-good" });
  });

  test("shows a retry as running and preserves error and approval states", () => {
    const detail = { session, turns: [{ status: "cancelled" }] } as const;
    expect(chatStatusInfo(detail, true).label).toBe("Running");
    expect(
      chatStatusInfo(
        { ...detail, session: { ...session, activeTurnId: "retry" } },
        false,
      ).label,
    ).toBe("Running");
    expect(
      chatStatusInfo({ session, turns: [{ status: "failed" }] }, false).label,
    ).toBe("Failed");
    expect(
      chatStatusInfo(
        { session, turns: [{ status: "waiting_for_user" }] },
        false,
      ).label,
    ).toBe("Waiting for approval");
  });
});
