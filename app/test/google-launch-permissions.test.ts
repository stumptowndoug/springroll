import { describe, expect, test } from "bun:test";
import {
  grantedOAuthPermissionSetIds,
  nextOAuthPermissionSetIds,
  oauthScopeForPermissionSets,
  parseConnectorManifest,
} from "@springroll/kernel";
import { curatedConnectorManifests } from "../src/server/connector-registry.ts";
import { googleLaunchManifest } from "../src/server/google-launch-permissions.ts";

function manifest(id: string, staging = false) {
  const source = curatedConnectorManifests.find((item) => item.id === id);
  if (!source) throw new Error(`Missing ${id}`);
  return parseConnectorManifest(googleLaunchManifest(source, staging));
}

describe("Google launch permission boundary", () => {
  test("production omits write tools and rejects both new and legacy upgrades", () => {
    for (const id of ["gmail", "google-calendar", "google-drive"]) {
      const current = manifest(id);
      if (current.transport.kind !== "http-api")
        throw new Error("Expected native API");
      expect(
        current.transport.operations.every(
          (operation) => operation.effect === "read",
        ),
      ).toBe(true);
      expect(
        grantedOAuthPermissionSetIds(
          {
            grantedPermissionSets: [
              "read",
              "send",
              "drafts",
              "organize",
              "write",
            ],
          },
          current,
        ),
      ).toEqual(["read"]);
      for (const extra of ["send", "drafts", "organize", "write"]) {
        expect(() => nextOAuthPermissionSetIds(current, {}, extra)).toThrow();
      }
      expect(
        oauthScopeForPermissionSets(current, [
          "read",
          "send",
          "drafts",
          "write",
        ]),
      ).not.toMatch(
        /gmail\.(compose|send|modify)|calendar\.events|auth\/drive(?: |$)/,
      );
      expect(
        current.tools?.allow?.every(
          (name) =>
            current.transport.kind === "http-api" &&
            current.transport.operations.some(
              (operation) => operation.name === name,
            ),
        ),
      ).toBe(true);
    }
  });

  test("explicit staging enables only the submitted Gmail and Calendar upgrades", () => {
    expect(
      oauthScopeForPermissionSets(manifest("gmail", true), [
        "read",
        "drafts",
        "send",
      ]),
    ).toBe(
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send",
    );
    expect(
      oauthScopeForPermissionSets(manifest("google-calendar", true), [
        "read",
        "write",
      ]),
    ).toContain("auth/calendar.events");
    expect(() =>
      nextOAuthPermissionSetIds(manifest("gmail", true), {}, "organize"),
    ).toThrow();
    expect(() =>
      nextOAuthPermissionSetIds(manifest("google-drive", true), {}, "write"),
    ).toThrow();
    expect(manifest("google-drive", true).tools?.allow).toEqual([
      "download_file",
      "export_file",
      "get_file",
      "search_files",
    ]);
  });

  test("does not restrict Microsoft write permissions", () => {
    expect(
      oauthScopeForPermissionSets(manifest("outlook"), ["read", "write"]),
    ).toContain("Mail.Send");
  });
});
