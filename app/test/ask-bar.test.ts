import { describe, expect, test } from "bun:test";
import {
  ASK_BAR_PENDING_FILES_STATE,
  ASK_BAR_PENDING_SESSION_STATE,
  ASK_BAR_PENDING_STATE,
  askBarComposerAction,
  pendingAskBarSubmissionFromState,
} from "../src/client/ask-bar.tsx";

describe("ask bar composer keys", () => {
  test("Enter sends and Shift+Enter stays in the field", () => {
    expect(askBarComposerAction("Enter", false)).toBe("submit");
    expect(askBarComposerAction("Enter", true)).toBeUndefined();
    expect(askBarComposerAction("Escape", false)).toBe("blur");
    expect(askBarComposerAction("a", false)).toBeUndefined();
  });
});

describe("in-place ask bar submissions", () => {
  test("carries the new session, text, and valid attachments to the entity surface", () => {
    expect(
      pendingAskBarSubmissionFromState({
        [ASK_BAR_PENDING_SESSION_STATE]: "chat-run",
        [ASK_BAR_PENDING_STATE]: "What caused this?",
        [ASK_BAR_PENDING_FILES_STATE]: [
          {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,AA==",
          },
          { type: "text", text: "not a file" },
        ],
      }),
    ).toEqual({
      sessionId: "chat-run",
      text: "What caused this?",
      files: [
        {
          type: "file",
          mediaType: "image/png",
          url: "data:image/png;base64,AA==",
        },
      ],
    });
  });

  test("ignores empty or malformed navigation state", () => {
    expect(pendingAskBarSubmissionFromState(undefined)).toEqual({ files: [] });
    expect(
      pendingAskBarSubmissionFromState({
        [ASK_BAR_PENDING_SESSION_STATE]: " ",
        [ASK_BAR_PENDING_STATE]: " ",
        [ASK_BAR_PENDING_FILES_STATE]: [{}],
      }),
    ).toEqual({ files: [] });
  });
});
