import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";

const sha256Pattern = /^[a-f0-9]{64}$/;
const defaultMaxBlobBytes = 10 * 1024 * 1024;
const defaultMaxTotalBytes = 512 * 1024 * 1024;

export interface StoredBlobRef {
  readonly sha256: string;
  readonly byteSize: number;
}

export interface ArtifactBlobStore {
  put(bytes: Uint8Array): Promise<StoredBlobRef>;
  get(sha256: string): Promise<Uint8Array | undefined>;
  delete(sha256: string): Promise<void>;
  totalBytes(): Promise<number>;
}

export interface FilesystemArtifactBlobStoreOptions {
  readonly maxBlobBytes?: number;
  readonly maxTotalBytes?: number;
}

export class ArtifactBlobTooLargeError extends Error {
  override readonly name = "ArtifactBlobTooLargeError";

  constructor(
    readonly byteSize: number,
    readonly maximumByteSize: number,
  ) {
    super(
      `Artifact is ${byteSize.toLocaleString()} bytes; the maximum is ${maximumByteSize.toLocaleString()} bytes`,
    );
  }
}

export class ArtifactStorageFullError extends Error {
  override readonly name = "ArtifactStorageFullError";

  constructor(
    readonly requestedBytes: number,
    readonly currentBytes: number,
    readonly maximumBytes: number,
  ) {
    super(
      `Artifact storage is full (${currentBytes.toLocaleString()} of ${maximumBytes.toLocaleString()} bytes used; ${requestedBytes.toLocaleString()} more requested)`,
    );
  }
}

export class FilesystemArtifactBlobStore implements ArtifactBlobStore {
  readonly #maxBlobBytes: number;
  readonly #maxTotalBytes: number;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(
    readonly rootDirectory: string,
    options: FilesystemArtifactBlobStoreOptions = {},
  ) {
    if (!rootDirectory) {
      throw new TypeError("Artifact root directory must not be empty");
    }
    this.#maxBlobBytes = positiveInteger(
      options.maxBlobBytes ?? defaultMaxBlobBytes,
      "maxBlobBytes",
    );
    this.#maxTotalBytes = positiveInteger(
      options.maxTotalBytes ?? defaultMaxTotalBytes,
      "maxTotalBytes",
    );
    if (this.#maxBlobBytes > this.#maxTotalBytes) {
      throw new RangeError("maxBlobBytes must not exceed maxTotalBytes");
    }
  }

  async put(bytes: Uint8Array): Promise<StoredBlobRef> {
    if (bytes.byteLength > this.#maxBlobBytes) {
      throw new ArtifactBlobTooLargeError(bytes.byteLength, this.#maxBlobBytes);
    }

    return this.#withWriteLock(async () => {
      await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const target = join(this.rootDirectory, sha256);
      if (await regularFileSize(target)) {
        return { sha256, byteSize: bytes.byteLength };
      }

      const currentBytes = await this.totalBytes();
      if (currentBytes + bytes.byteLength > this.#maxTotalBytes) {
        throw new ArtifactStorageFullError(
          bytes.byteLength,
          currentBytes,
          this.#maxTotalBytes,
        );
      }

      const temporary = join(
        this.rootDirectory,
        `.${sha256}.${randomUUID()}.tmp`,
      );
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporary, target);
      } catch (error) {
        await handle?.close().catch(() => undefined);
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }

      return { sha256, byteSize: bytes.byteLength };
    });
  }

  async get(sha256: string): Promise<Uint8Array | undefined> {
    if (!sha256Pattern.test(sha256)) return undefined;
    try {
      return await readFile(join(this.rootDirectory, sha256));
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  async delete(sha256: string): Promise<void> {
    if (!sha256Pattern.test(sha256)) return;
    await this.#withWriteLock(async () => {
      await rm(join(this.rootDirectory, sha256), { force: true });
    });
  }

  async totalBytes(): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(this.rootDirectory);
    } catch (error) {
      if (isMissingFileError(error)) return 0;
      throw error;
    }

    const sizes = await Promise.all(
      entries
        .filter((entry) => sha256Pattern.test(entry))
        .map((entry) => regularFileSize(join(this.rootDirectory, entry))),
    );
    let total = 0;
    for (const size of sizes) total += size ?? 0;
    return total;
  }

  async #withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#writeTail;
    let release = () => {};
    this.#writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

async function regularFileSize(path: string): Promise<number | undefined> {
  try {
    const details = await stat(path);
    return details.isFile() ? details.size : undefined;
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
