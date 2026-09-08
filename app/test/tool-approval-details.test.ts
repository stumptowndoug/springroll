import { expect, test } from "bun:test";
import { toolApprovalDetails } from "../src/client/tool-approval-details.ts";

test("empty Gmail draft cannot be presented as a complete approval", () => {
  const details = toolApprovalDetails({
    connectionId: "gmail-default",
    toolName: "create_draft",
    input: {},
  });
  expect(details.blockedReason).toContain("to, subject, body missing");
  expect(details.input).toContain("To: [missing]");
  expect(details.input).not.toBe("{}");
});

test("email approval displays complete recipients and content without truncation", () => {
  const body = "Email content ".repeat(400);
  const details = toolApprovalDetails({
    connectionId: "gmail-second",
    toolName: "send_message",
    input: {
      to: "test@example.com",
      cc: "copy@example.com",
      subject: "Hiking",
      body,
    },
  });
  expect(details.blockedReason).toBeUndefined();
  expect(details.input).toContain("To: test@example.com");
  expect(details.input).toContain("cc: copy@example.com");
  expect(details.input).toContain(body);
});

test("a parameterless non-email tool remains approvable", () => {
  const details = toolApprovalDetails({
    connectionId: "other",
    toolName: "refresh",
    input: {},
  });
  expect(details.input).toBe("No parameters supplied.");
  expect(details.blockedReason).toBeUndefined();
});
