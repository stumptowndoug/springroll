import { describe, expect, test } from "bun:test";
import {
  intersectAvailableIn,
  recipeHosting,
} from "../src/execution-availability.ts";

describe("recipe hosting eligibility", () => {
  test("a recipe with no connections can run locally or hosted", () => {
    expect(recipeHosting([])).toEqual({
      availableIn: ["local", "hosted"],
      hostedBlockedBy: [],
    });
  });

  test("remote APIs and MCP stay hostable", () => {
    expect(
      recipeHosting([
        {
          id: "neon",
          name: "Neon",
          availableIn: ["local", "hosted"],
        },
        {
          id: "web",
          name: "Web",
          availableIn: ["local", "hosted"],
        },
      ]),
    ).toEqual({
      availableIn: ["local", "hosted"],
      hostedBlockedBy: [],
    });
  });

  test("one local-only integration keeps the whole recipe on this Mac", () => {
    expect(
      recipeHosting([
        {
          id: "web",
          name: "Web",
          availableIn: ["local", "hosted"],
        },
        {
          id: "clarity",
          name: "Microsoft Clarity",
          availableIn: ["local"],
        },
        {
          id: "clarity-again",
          name: "Microsoft Clarity",
          availableIn: ["local"],
        },
      ]),
    ).toEqual({
      availableIn: ["local"],
      hostedBlockedBy: ["Microsoft Clarity"],
    });
  });

  test("dedupes the same connection pinned twice", () => {
    expect(
      recipeHosting([
        {
          id: "clarity",
          name: "Microsoft Clarity",
          availableIn: ["local"],
        },
        {
          id: "clarity",
          name: "Microsoft Clarity",
          availableIn: ["local"],
        },
      ]).hostedBlockedBy,
    ).toEqual(["Microsoft Clarity"]);
  });

  test("intersectAvailableIn requires every item to allow the location", () => {
    expect(intersectAvailableIn([])).toEqual(["local", "hosted"]);
    expect(intersectAvailableIn([["local"], ["local", "hosted"]])).toEqual([
      "local",
    ]);
  });
});
