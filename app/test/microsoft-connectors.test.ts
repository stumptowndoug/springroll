import { describe, expect, test } from "bun:test";
import {
  type CredentialStore,
  createDocumentedApiToolSource,
  type JsonObject,
} from "@springroll/kernel";
import { microsoftConnectorManifests } from "../src/server/microsoft-connectors.ts";

class EmptyCredentials implements CredentialStore {
  async get(): Promise<string | undefined> {
    return undefined;
  }
  async put(): Promise<void> {}
  async delete(): Promise<void> {}
}

interface MicrosoftCallFixture {
  readonly read: readonly [string, JsonObject];
  readonly write: readonly [string, JsonObject];
  readonly readPath: string;
  readonly writePath: string;
}

const calls: Readonly<Record<string, MicrosoftCallFixture>> = {
  outlook: {
    read: ["list_messages", { top: 2 }],
    write: [
      "send_mail",
      {
        message: {
          subject: "Status",
          body: { contentType: "Text", content: "Ready" },
          toRecipients: [{ emailAddress: { address: "team@example.com" } }],
        },
        saveToSentItems: true,
      },
    ],
    readPath: "/v1.0/me/messages",
    writePath: "/v1.0/me/sendMail",
  },
  onedrive: {
    read: ["search_files", { query: "quarterly plan", top: 3 }],
    write: [
      "create_folder",
      {
        parentId: "parent 1",
        item: {
          name: "Plans",
          folder: {},
          "@microsoft.graph.conflictBehavior": "rename",
        },
      },
    ],
    readPath: "/v1.0/me/drive/root/search(q='quarterly%20plan')",
    writePath: "/v1.0/me/drive/items/parent%201/children",
  },
  "microsoft-teams": {
    read: ["list_chat_messages", { chatId: "chat 1", top: 4 }],
    write: [
      "send_chat_message",
      {
        chatId: "chat 1",
        message: { body: { content: "Deployment finished" } },
      },
    ],
    readPath: "/v1.0/chats/chat%201/messages",
    writePath: "/v1.0/chats/chat%201/messages",
  },
  sharepoint: {
    read: ["list_list_items", { siteId: "site 1", listId: "list 1", top: 5 }],
    write: [
      "create_list_item",
      {
        siteId: "site 1",
        listId: "list 1",
        fields: { Title: "Launch checklist" },
      },
    ],
    readPath: "/v1.0/sites/site%201/lists/list%201/items",
    writePath: "/v1.0/sites/site%201/lists/list%201/items",
  },
};

function fixtureFor(manifestId: string): MicrosoftCallFixture {
  const fixture = calls[manifestId];
  if (!fixture) throw new TypeError(`Missing Microsoft fixture: ${manifestId}`);
  return fixture;
}

describe("Microsoft 365 native connectors", () => {
  test("keep write tools behind an explicit permission upgrade", async () => {
    for (const manifest of microsoftConnectorManifests) {
      const fixture = fixtureFor(manifest.id);
      const source = createDocumentedApiToolSource({
        manifest,
        credentials: new EmptyCredentials(),
        oauthAccessToken: async () => "graph-access-token",
        fetch: async () => Response.json({ value: [] }),
      });
      const baseConnection = {
        id: `${manifest.id}-account`,
        sourceId: "http-api" as const,
        manifestId: manifest.id,
        credentialRef: `${manifest.id}-credential`,
        availableIn: ["local" as const],
      };
      const readSession = await source.open({
        connection: baseConnection,
        location: "local",
      });
      const readTools = (await readSession.listTools()).map(
        (tool) => tool.name,
      );
      expect(readTools).not.toContain(fixture.write[0]);

      const writeSession = await source.open({
        connection: {
          ...baseConnection,
          config: { grantedPermissionSets: ["read", "write"] },
        },
        location: "local",
      });
      expect(
        (await writeSession.listTools()).map((tool) => tool.name),
      ).toContain(fixture.write[0]);
    }
  });

  test("maps representative reads and writes to Graph with host-only bearer auth", async () => {
    for (const manifest of microsoftConnectorManifests) {
      const requests: Array<{
        readonly url: URL;
        readonly method: string;
        readonly authorization: string | null;
        readonly body?: unknown;
      }> = [];
      const source = createDocumentedApiToolSource({
        manifest,
        credentials: new EmptyCredentials(),
        oauthAccessToken: async () => "graph-access-token",
        fetch: async (input, init) => {
          requests.push({
            url: new URL(String(input)),
            method: init?.method ?? "GET",
            authorization: new Headers(init?.headers).get("authorization"),
            ...(typeof init?.body === "string"
              ? { body: JSON.parse(init.body) }
              : {}),
          });
          return Response.json({ value: [] });
        },
      });
      const session = await source.open({
        connection: {
          id: `${manifest.id}-account`,
          sourceId: "http-api",
          manifestId: manifest.id,
          credentialRef: `${manifest.id}-credential`,
          config: { grantedPermissionSets: ["read", "write"] },
          availableIn: ["local"],
        },
        location: "local",
      });
      const fixture = fixtureFor(manifest.id);
      await session.callTool(fixture.read[0], fixture.read[1], {
        taskId: "task-1",
        runId: "run-1",
      });
      await session.callTool(fixture.write[0], fixture.write[1], {
        taskId: "task-1",
        runId: "run-1",
      });

      expect(requests).toHaveLength(2);
      expect(requests[0]?.url.pathname).toBe(fixture.readPath);
      expect(requests[0]?.method).toBe("GET");
      expect(requests[1]?.url.pathname).toBe(fixture.writePath);
      expect(requests[1]?.method).toBe("POST");
      expect(
        requests.every(
          (request) => request.authorization === "Bearer graph-access-token",
        ),
      ).toBe(true);
      expect(requests[1]?.body).toBeDefined();
    }
  });
});
