import { expect, test } from "bun:test";
import {
  RequestGate,
  startSerialPolling,
} from "../src/client/async-refresh.ts";

test("a newer load or navigation invalidates old responses", () => {
  const gate = new RequestGate();
  const first = gate.begin();
  const second = gate.begin();
  expect(first()).toBe(false);
  expect(second()).toBe(true);
  gate.invalidate();
  expect(second()).toBe(false);
});

test("polling never overlaps and does not restart after cleanup", async () => {
  let count = 0;
  let release!: () => void;
  let started!: () => void;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = startSerialPolling(
    async () => {
      count += 1;
      started();
      await blocked;
    },
    () => true,
    1,
  );
  await start;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(count).toBe(1);
  stop();
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(count).toBe(1);
});

test("hidden pages do not make polling requests", async () => {
  let count = 0;
  const stop = startSerialPolling(
    async () => {
      count += 1;
    },
    () => false,
    1,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  stop();
  expect(count).toBe(0);
});
