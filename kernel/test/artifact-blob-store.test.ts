import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ArtifactBlobStore,
  ArtifactBlobTooLargeError,
  ArtifactStorageFullError,
  FilesystemArtifactBlobStore,
} from "../src/storage/artifact-blob-store.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function describeArtifactBlobStoreContract(
  makeStore: () => Promise<{
    store: ArtifactBlobStore;
    rootDirectory: string;
  }>,
): void {
  test("stores and retrieves bytes by their stable SHA-256", async () => {
    const { store } = await makeStore();
    const bytes = new TextEncoder().encode("springroll-image-bytes");
    const expectedHash = createHash("sha256").update(bytes).digest("hex");

    const first = await store.put(bytes);
    const second = await store.put(bytes);

    expect(first).toEqual({
      sha256: expectedHash,
      byteSize: bytes.byteLength,
    });
    expect(second).toEqual(first);
    expect(await store.get(expectedHash)).toEqual(bytes);
    expect(await store.totalBytes()).toBe(bytes.byteLength);
  });

  test("returns undefined for unknown and invalid hashes", async () => {
    const { store } = await makeStore();

    expect(await store.get("a".repeat(64))).toBeUndefined();
    expect(await store.get("../springroll.sqlite")).toBeUndefined();
  });

  test("deletes a stored blob", async () => {
    const { store } = await makeStore();
    const stored = await store.put(new Uint8Array([1, 2, 3]));

    await store.delete(stored.sha256);

    expect(await store.get(stored.sha256)).toBeUndefined();
    expect(await store.totalBytes()).toBe(0);
  });

  test("ignores interrupted temporary files", async () => {
    const { store, rootDirectory } = await makeStore();
    await mkdir(rootDirectory, { recursive: true });
    await writeFile(join(rootDirectory, ".interrupted.tmp"), "partial");

    expect(await store.totalBytes()).toBe(0);
    expect(await store.get("b".repeat(64))).toBeUndefined();
  });
}

describe("FilesystemArtifactBlobStore", () => {
  describeArtifactBlobStoreContract(async () => {
    const rootDirectory = await temporaryArtifactDirectory();
    return {
      rootDirectory,
      store: new FilesystemArtifactBlobStore(rootDirectory),
    };
  });

  test("rejects a blob larger than the per-blob limit", async () => {
    const rootDirectory = await temporaryArtifactDirectory();
    const store = new FilesystemArtifactBlobStore(rootDirectory, {
      maxBlobBytes: 3,
      maxTotalBytes: 10,
    });

    await expect(store.put(new Uint8Array(4))).rejects.toBeInstanceOf(
      ArtifactBlobTooLargeError,
    );
    expect(await store.totalBytes()).toBe(0);
  });

  test("rejects new bytes after reaching the total storage limit", async () => {
    const rootDirectory = await temporaryArtifactDirectory();
    const store = new FilesystemArtifactBlobStore(rootDirectory, {
      maxBlobBytes: 4,
      maxTotalBytes: 5,
    });
    const original = new Uint8Array([1, 2, 3]);
    await store.put(original);

    await expect(store.put(new Uint8Array([4, 5, 6]))).rejects.toBeInstanceOf(
      ArtifactStorageFullError,
    );
    expect(await store.totalBytes()).toBe(original.byteLength);
  });

  test("does not charge duplicate bytes against the total limit", async () => {
    const rootDirectory = await temporaryArtifactDirectory();
    const store = new FilesystemArtifactBlobStore(rootDirectory, {
      maxBlobBytes: 3,
      maxTotalBytes: 3,
    });
    const bytes = new Uint8Array([1, 2, 3]);

    await store.put(bytes);
    await expect(store.put(bytes)).resolves.toEqual({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
    });
  });
});

async function temporaryArtifactDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "springroll-artifacts-"));
  temporaryDirectories.push(directory);
  return directory;
}
