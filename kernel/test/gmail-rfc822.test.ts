import { describe, expect, test } from "bun:test";
import { gmailRfc822Raw, gmailRfc822RequestBody } from "../src/gmail-rfc822.ts";

describe("gmail RFC 822 encoding", () => {
  test("encodes a plain send body as base64url raw MIME", () => {
    const raw = gmailRfc822Raw({
      to: "ada@example.com",
      subject: "Hello",
      body: "On the way.",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: ada@example.com");
    expect(decoded).toContain("Subject: Hello");
    expect(decoded).toContain("\r\n\r\nOn the way.");
    expect(raw).not.toContain("=");
  });

  test("wraps drafts in a Gmail message envelope", () => {
    expect(
      gmailRfc822RequestBody(
        {
          to: "ada@example.com",
          subject: "Hello",
          body: "Draft",
          threadId: "thread-1",
        },
        "message",
      ),
    ).toMatchObject({
      message: {
        threadId: "thread-1",
      },
    });
  });
});
