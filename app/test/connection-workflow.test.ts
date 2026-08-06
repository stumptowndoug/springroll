import { describe, expect, test } from "bun:test";
import {
  type AppApi,
  type AssistantApi,
  createHttpApp,
} from "../src/server/http-app.ts";
import type { ConnectionCardDto } from "../src/shared.ts";

interface TestWorkflow {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: "connection_setup";
  status:
    | "proposed"
    | "in_progress"
    | "waiting_for_user"
    | "completed"
    | "failed"
    | "cancelled";
  readonly payload: Record<string, unknown>;
  outcome?: Record<string, unknown>;
  subjectKind?: "connection";
  subjectId?: string;
  error?: string | null;
}

describe("durable connection workflows", () => {
  test("submits an API key only to the host connector call", async () => {
    const secret = "sk_live_never-persist-this";
    const workflow = connectionWorkflow("api-key");
    const connection = connectionCard("api-key");
    let connectorInput: unknown;
    let connectAttempts = 0;
    const assistant = workflowAssistant(workflow);
    const application = workflowApplication({
      connection,
      connect(input) {
        connectAttempts += 1;
        connectorInput = input;
        if (connectAttempts === 1) {
          throw new TypeError(`Connector rejected ${secret}`);
        }
        return { ...connection, status: "connected", toolCount: 2 };
      },
    });
    const http = createHttpApp(application, undefined, assistant.api);
    const base = `/api/chats/${workflow.sessionId}/workflows/${workflow.id}`;

    const prepared = await http.request(`${base}/prepare-connection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId: "variant-api-key" }),
    });
    expect(prepared.status).toBe(200);
    expect(await prepared.json()).toMatchObject({
      status: "awaiting_api_key",
      connection: { id: connection.id, credentialKind: "api-key" },
    });
    expect(workflow).toMatchObject({
      status: "waiting_for_user",
      outcome: {
        phase: "prepared",
        connectorId: connection.id,
        credentialKind: "api-key",
      },
    });

    const rejected = await http.request(`${base}/connect-key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: secret }),
    });
    const rejectedText = await rejected.text();
    expect(rejected.status).toBe(400);
    expect(rejectedText).not.toContain(secret);
    expect(JSON.stringify(workflow)).not.toContain(secret);
    expect(workflow).toMatchObject({
      status: "waiting_for_user",
      outcome: {
        phase: "prepared",
        ceremony: { state: "failed", retryable: true },
      },
    });

    const connected = await http.request(`${base}/connect-key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: secret }),
    });
    const connectedText = await connected.text();
    expect(connected.status).toBe(200);
    expect(JSON.parse(connectedText)).toMatchObject({
      status: "connected",
      connection: { id: connection.id, status: "connected" },
    });
    expect(connectorInput).toEqual({ apiKey: secret });
    expect(connectedText).not.toContain(secret);
    expect(JSON.stringify(workflow)).not.toContain(secret);
    expect(JSON.stringify(assistant.context)).not.toContain(secret);
    expect(workflow).toMatchObject({
      status: "completed",
      subjectKind: "connection",
      subjectId: connection.id,
      outcome: { connected: true, toolsDiscovered: true, toolCount: 2 },
    });
  });

  test("connects a no-credential proposal and rejects unproposed variants", async () => {
    const workflow = connectionWorkflow("none");
    const connection = connectionCard("none");
    let connectCount = 0;
    const assistant = workflowAssistant(workflow);
    const application = workflowApplication({
      connection,
      connect(input) {
        connectCount += 1;
        expect(input).toEqual({});
        return { ...connection, status: "connected", toolCount: 1 };
      },
    });
    const http = createHttpApp(application, undefined, assistant.api);
    const path = `/api/chats/${workflow.sessionId}/workflows/${workflow.id}/prepare-connection`;

    const rejected = await http.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId: "not-proposed" }),
    });
    expect(rejected.status).toBe(400);
    expect(connectCount).toBe(0);

    const connected = await http.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId: "variant-none" }),
    });
    expect(connected.status).toBe(200);
    expect(await connected.json()).toMatchObject({ status: "connected" });
    expect(connectCount).toBe(1);
    expect(workflow.status).toBe("completed");
    expect(assistant.continuationRequests).toBe(0);
  });

  test("preserves a broader recipe goal and requests a safe continuation", async () => {
    const workflow = connectionWorkflow("none");
    const connection = connectionCard("none");
    const assistant = workflowAssistant(workflow, {
      version: 1,
      intent: "task.create",
      origin: "recipes",
      subjects: [{ kind: "task", id: "draft-recipe" }],
    });
    const application = workflowApplication({
      connection,
      connect() {
        return { ...connection, status: "connected", toolCount: 2 };
      },
    });
    const http = createHttpApp(application, undefined, assistant.api);

    const response = await http.request(
      `/api/chats/${workflow.sessionId}/workflows/${workflow.id}/prepare-connection`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId: "variant-none" }),
      },
    );

    expect(response.status).toBe(200);
    await Promise.resolve();
    expect(assistant.context).toEqual({
      version: 1,
      intent: "task.create",
      origin: "recipes",
      subjects: [
        { kind: "task", id: "draft-recipe" },
        { kind: "connection", id: connection.id },
      ],
    });
    expect(assistant.continuationRequests).toBe(1);

    assistant.makeContinuationRetryable();
    const retried = await http.request(
      `/api/chats/${workflow.sessionId}/workflows/${workflow.id}/continue-connection`,
      { method: "POST" },
    );
    expect(retried.status).toBe(202);
    expect(await retried.json()).toEqual({ status: "continuing" });
    expect(assistant.continuationRequests).toBe(2);
  });

  test("uses the stored manifest when a researched proposal outlives app memory", async () => {
    const workflow = connectionWorkflow("none");
    const proposal = workflow.payload.proposal as Record<string, unknown>;
    proposal.templateId = "research-fixture";
    proposal.manifest = {
      id: "researched-fixture",
      name: "Researched Fixture",
      blurb: "A verified remote connector",
      transport: {
        kind: "mcp-remote",
        endpoint: "https://fixture.example/mcp",
      },
      credential: { kind: "none" },
    };
    const connection = {
      ...connectionCard("none"),
      id: "researched-fixture",
    };
    let durableManifest: unknown;
    const assistant = workflowAssistant(workflow);
    const application = workflowApplication({
      connection,
      prepare(_templateId, _variantId, manifest) {
        durableManifest = manifest;
      },
      connect() {
        return { ...connection, status: "connected" };
      },
    });
    const http = createHttpApp(application, undefined, assistant.api);

    const response = await http.request(
      `/api/chats/${workflow.sessionId}/workflows/${workflow.id}/prepare-connection`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId: "variant-none" }),
      },
    );

    expect(response.status).toBe(200);
    expect(durableManifest).toEqual(proposal.manifest);
    expect(workflow.status).toBe("completed");
  });

  test("declines setup without collecting a credential and continues a broader goal", async () => {
    const workflow = connectionWorkflow("api-key");
    const assistant = workflowAssistant(workflow, {
      version: 1,
      intent: "task.create",
      origin: "recipes",
      subjects: [],
    });
    const application = workflowApplication({
      connection: connectionCard("api-key"),
    });
    const http = createHttpApp(application, undefined, assistant.api);
    const path = `/api/chats/${workflow.sessionId}/workflows/${workflow.id}/decline-connection`;

    const response = await http.request(path, { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "declined" });
    expect(workflow).toMatchObject({
      status: "cancelled",
      outcome: { state: "declined", retryable: true },
    });
    expect(JSON.stringify(workflow.outcome)).not.toContain("api-key");
    expect(JSON.stringify(workflow.outcome)).not.toContain("secret");
    expect(assistant.continuationRequests).toBe(1);

    const repeated = await http.request(path, { method: "POST" });
    expect(repeated.status).toBe(409);
  });

  test("completes OAuth from one authorization using a stable callback", async () => {
    const workflow = connectionWorkflow("oauth");
    const connection = connectionCard("oauth");
    const assistant = workflowAssistant(workflow);
    let callbackUrl = "";
    let pendingReturnTo = "";
    let authorizationStarts = 0;
    const application = workflowApplication({
      connection,
      startOAuth(redirectUrl, returnTo) {
        authorizationStarts += 1;
        callbackUrl = redirectUrl;
        pendingReturnTo = returnTo ?? "";
        return {
          status: "redirect",
          authorizationUrl: "https://provider.example/authorize",
        };
      },
      completeOAuth() {
        return { ...connection, status: "connected", toolCount: 3 };
      },
    });
    const http = createHttpApp(application, undefined, assistant.api);
    const preparePath = `/api/chats/${workflow.sessionId}/workflows/${workflow.id}/prepare-connection`;

    const started = await http.request(preparePath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId: "variant-oauth" }),
    });
    expect(started.status).toBe(200);
    expect(authorizationStarts).toBe(1);
    expect(new URL(callbackUrl).search).toBe("");
    expect(pendingReturnTo).toContain(`/chat/${workflow.sessionId}`);

    const completedUrl = new URL(callbackUrl);
    completedUrl.searchParams.set("code", "oauth-code");
    completedUrl.searchParams.set("state", "oauth-state");
    const completed = await http.request(completedUrl);

    expect(completed.status).toBe(302);
    expect(completed.headers.get("location")).toContain(
      `/chat/${workflow.sessionId}`,
    );
    expect(authorizationStarts).toBe(1);
    expect(workflow).toMatchObject({
      status: "completed",
      subjectId: connection.id,
      error: null,
    });
  });

  test("finishes OAuth in the callback and leaves provider errors retryable", async () => {
    const workflow = connectionWorkflow("oauth");
    const connection = connectionCard("oauth");
    const assistant = workflowAssistant(workflow);
    let callbackUrl = "";
    let pendingReturnTo = "";
    const application = workflowApplication({
      connection,
      startOAuth(redirectUrl, returnTo) {
        callbackUrl = redirectUrl;
        pendingReturnTo = returnTo ?? "";
        return {
          status: "redirect",
          authorizationUrl: "https://provider.example/authorize",
        };
      },
      completeOAuth() {
        return { ...connection, status: "connected", toolCount: 3 };
      },
    });
    const http = createHttpApp(application, undefined, assistant.api);
    const preparePath = `/api/chats/${workflow.sessionId}/workflows/${workflow.id}/prepare-connection`;

    const started = await http.request(preparePath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId: "variant-oauth" }),
    });
    expect(await started.json()).toMatchObject({
      status: "redirect",
      authorizationUrl: "https://provider.example/authorize",
    });
    expect(workflow.status).toBe("waiting_for_user");
    expect(new URL(callbackUrl).search).toBe("");
    expect(pendingReturnTo).toContain(`workflow=${workflow.id}`);

    const rejectedUrl = new URL(callbackUrl);
    rejectedUrl.searchParams.set("error", "access_denied");
    rejectedUrl.searchParams.set("error_description", "Sign-in expired");
    const rejected = await http.request(rejectedUrl);
    expect(rejected.status).toBe(302);
    expect(workflow).toMatchObject({
      status: "waiting_for_user",
      error: "Sign-in expired",
      outcome: {
        phase: "prepared",
        ceremony: { state: "expired", retryable: true },
      },
    });

    const restarted = await http.request(preparePath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId: "variant-oauth" }),
    });
    expect(restarted.status).toBe(200);

    const unrelatedCallback = new URL(callbackUrl);
    unrelatedCallback.pathname = unrelatedCallback.pathname.replace(
      connection.id,
      "other-connection",
    );
    unrelatedCallback.searchParams.set("code", "unrelated-code");
    const unrelated = await http.request(unrelatedCallback);
    expect(unrelated.status).toBe(302);
    expect(workflow.status).toBe("waiting_for_user");

    const completedUrl = new URL(callbackUrl);
    completedUrl.searchParams.set("code", "oauth-code");
    completedUrl.searchParams.set("state", "oauth-state");
    const completed = await http.request(completedUrl);
    expect(completed.status).toBe(302);
    expect(completed.headers.get("location")).toContain("oauth=connected");
    expect(workflow).toMatchObject({
      status: "completed",
      subjectId: connection.id,
      outcome: { connected: true, toolsDiscovered: true, toolCount: 3 },
    });
    expect(workflow.error).toBeNull();
    expect(assistant.context).toMatchObject({
      intent: "connection.manage",
      subjects: [{ kind: "connection", id: connection.id }],
    });
  });
});

function connectionWorkflow(
  credentialKind: "oauth" | "api-key" | "none",
): TestWorkflow {
  return {
    id: `workflow-${credentialKind}`,
    sessionId: `chat-${credentialKind}`,
    kind: "connection_setup",
    status: "proposed",
    payload: {
      status: "ready",
      proposal: {
        templateId: "template-1",
        name: "Fixture",
        variants: [
          {
            id: `variant-${credentialKind}`,
            credentialKind,
          },
        ],
      },
    },
  };
}

function connectionCard(
  credentialKind: "oauth" | "api-key" | "none",
): ConnectionCardDto {
  return {
    id: "fixture-connection",
    name: "Fixture",
    description: "A test connection",
    status: "not_connected",
    credentialKind,
  };
}

function workflowAssistant(
  workflow: TestWorkflow,
  initialContext: unknown = {
    version: 1,
    intent: "connection.create",
    origin: "connections",
    subjects: [],
  },
): {
  readonly api: AssistantApi;
  context?: unknown;
  continuationRequests: number;
  makeContinuationRetryable(): void;
} {
  const state: {
    api: AssistantApi;
    context?: unknown;
    continuationRequests: number;
    retryableContinuation: boolean;
    makeContinuationRetryable(): void;
  } = {
    api: undefined as unknown as AssistantApi,
    context: initialContext,
    continuationRequests: 0,
    retryableContinuation: false,
    makeContinuationRetryable() {
      state.retryableContinuation = true;
    },
  };
  const api: Partial<AssistantApi> = {
    getSession(sessionId) {
      return sessionId === workflow.sessionId
        ? ({
            session: { context: state.context },
            messages: [],
            turns: state.retryableContinuation
              ? [{ id: "failed-continuation", status: "failed" }]
              : [],
          } as never)
        : undefined;
    },
    getWorkflow(sessionId, workflowId) {
      return sessionId === workflow.sessionId && workflowId === workflow.id
        ? (workflow as never)
        : undefined;
    },
    updateWorkflow(_sessionId, _workflowId, input) {
      workflow.status = input.status;
      if (input.error === undefined) delete workflow.error;
      else workflow.error = input.error;
      if (input.outcome) workflow.outcome = input.outcome;
      if (input.subject?.kind === "connection") {
        workflow.subjectKind = "connection";
        workflow.subjectId = input.subject.id;
      }
      return workflow as never;
    },
    updateSessionContext(_sessionId, context) {
      state.context = context;
      return undefined as never;
    },
    async continueConnectionWorkflow() {
      if (
        state.context &&
        typeof state.context === "object" &&
        "intent" in state.context &&
        (state.context.intent === "task.create" ||
          state.context.intent === "task.manage" ||
          state.context.intent === "run.diagnose")
      ) {
        state.continuationRequests += 1;
        return new Response("continued");
      }
      return undefined;
    },
  };
  state.api = api as AssistantApi;
  return state;
}

function workflowApplication(input: {
  readonly connection: ConnectionCardDto;
  readonly prepare?: (
    templateId: string,
    variantId: string,
    manifest: unknown,
  ) => void;
  readonly connect?: (
    input: Readonly<Record<string, unknown>>,
  ) => ConnectionCardDto;
  readonly startOAuth?: (
    redirectUrl: string,
    returnTo?: string,
  ) => {
    readonly status: "redirect";
    readonly authorizationUrl: string;
  };
  readonly completeOAuth?: () => ConnectionCardDto;
}): AppApi {
  let pendingOAuthReturnTo: string | undefined;
  const application: Partial<AppApi> = {
    async prepareIntegrationVariant(templateId, variantId, manifest) {
      input.prepare?.(templateId, variantId, manifest);
      return input.connection;
    },
    async connectConnector(_id, options) {
      return input.connect?.(options) ?? input.connection;
    },
    async startConnectorOAuth(_id, redirectUrl, returnTo) {
      pendingOAuthReturnTo = returnTo;
      return (
        input.startOAuth?.(redirectUrl, returnTo) ?? {
          status: "connected",
          connection: input.connection,
        }
      );
    },
    async connectorOAuthReturnTo(id) {
      return id === input.connection.id ? pendingOAuthReturnTo : undefined;
    },
    async completeConnectorOAuth() {
      return input.completeOAuth?.() ?? input.connection;
    },
    async listConnections() {
      return [input.connection];
    },
  };
  return application as AppApi;
}
