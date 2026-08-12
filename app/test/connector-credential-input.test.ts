import { expect, test } from "bun:test";
import {
  connectorCredentialComplete,
  connectorCredentialInput,
} from "../src/client/connector-credential-input.ts";
import type { ConnectionCardDto } from "../src/shared.ts";

const basicCard: ConnectionCardDto = {
  id: "dataforseo",
  name: "DataForSEO",
  description: "Read keyword metrics.",
  status: "not_connected",
  credentialKind: "api-key",
  credentialFields: [
    {
      name: "username",
      label: "DataForSEO API login",
      secret: false,
      autoComplete: "username",
    },
    {
      name: "password",
      label: "DataForSEO API password",
      secret: true,
      autoComplete: "current-password",
    },
  ],
};

test("requires and submits every HTTP Basic credential field together", () => {
  expect(
    connectorCredentialComplete(basicCard, "", {
      username: "login@example.test",
    }),
  ).toBe(false);
  expect(
    connectorCredentialComplete(basicCard, "", {
      username: "login@example.test",
      password: "secret-password",
    }),
  ).toBe(true);
  expect(
    connectorCredentialInput(basicCard, "ignored", {
      username: "login@example.test",
      password: "secret-password",
    }),
  ).toEqual({
    fields: {
      username: "login@example.test",
      password: "secret-password",
    },
  });
});
