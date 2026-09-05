/** Latest request wins; invalidate on navigation/unmount. */
export class RequestGate {
  #version = 0;
  begin(): () => boolean {
    const version = ++this.#version;
    return () => version === this.#version;
  }
  invalidate(): void {
    this.#version += 1;
  }
}

/** Schedule the next refresh only after the previous one has settled. */
export function startSerialPolling(
  poll: () => Promise<void>,
  visible: () => boolean,
  delay = 2_000,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      if (!stopped && visible()) await poll();
    } catch {
      /* The loader owns user-visible errors; keep recovery polling. */
    } finally {
      if (!stopped) timer = setTimeout(tick, delay);
    }
  };
  timer = setTimeout(tick, delay);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
