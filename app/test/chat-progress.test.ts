import { expect, test } from "bun:test";
import {
  AiSdkAssistant,
  chatTurns,
  openLocalDatabase,
  SqliteChatStore,
} from "@springroll/kernel";
import { MockLanguageModelV4 } from "ai/test";
import { type AppApi, createHttpApp } from "../src/server/http-app.ts";

test("progress omits message history and historic turn detail", async () => {
  const local = openLocalDatabase({ filename: ":memory:" });
  try {
    const store = new SqliteChatStore(local.db);
    const session = store.createSession();
    store.appendMessage({
      sessionId: session.id,
      role: "user",
      parts: [{ type: "text", text: "Long history" }],
    });
    for (let index = 0; index < 30; index += 1)
      local.db
        .insert(chatTurns)
        .values({
          id: `turn-${index}`,
          sessionId: session.id,
          status: "completed",
          createdAt: new Date(index),
        })
        .run();
    const assistant = new AiSdkAssistant(local.db, {
      loadRuntime: async () => ({
        model: new MockLanguageModelV4(),
        provider: "mock",
        modelId: "mock",
        tools: {},
      }),
    });
    const app = createHttpApp({} as AppApi, undefined, assistant);
    const full = await (await app.request(`/api/chats/${session.id}`)).json();
    const progress = await (
      await app.request(`/api/chats/${session.id}?progress=1`)
    ).json();
    expect(full.messages).toHaveLength(1);
    expect(full.turns).toHaveLength(30);
    expect(progress.messages).toHaveLength(0);
    expect(progress.turns).toHaveLength(1);
    expect(progress.turns[0].id).toBe("turn-29");
    expect(progress.session).toEqual(full.session);
  } finally {
    local.close();
  }
});
