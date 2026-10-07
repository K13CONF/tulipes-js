import { HttpError } from "@tulipes/core/http";

/** Recheck one authorization at a time and expire permission from its start time. */
export class AccessLease {
  #closed = false;
  #expiresAt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pending: Promise<boolean> | undefined;
  #abort: AbortController | undefined;

  readonly #authorize: (signal: AbortSignal) => Promise<boolean>;
  readonly #intervalMs: number;
  readonly #timeoutMs: number;
  readonly #onInvalid: () => void;

  constructor(
    authorize: (signal: AbortSignal) => Promise<boolean>,
    intervalMs: number,
    timeoutMs: number,
    onInvalid: () => void,
  ) {
    this.#authorize = authorize;
    this.#intervalMs = intervalMs;
    this.#timeoutMs = timeoutMs;
    this.#onInvalid = onInvalid;
  }

  get valid(): boolean {
    return !this.#closed && Date.now() < this.#expiresAt;
  }

  async start(): Promise<void> {
    await this.#check();
  }

  /** Keep capacity reserved until even an uncooperative pending check settles. */
  async close(): Promise<void> {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#abort?.abort();
    await this.#pending?.catch(() => {});
  }

  async #check(): Promise<void> {
    if (this.#closed) return;

    const started = Date.now();
    const deadline = Math.min(
      this.#expiresAt || Infinity,
      started + this.#timeoutMs,
    );
    const abort = new AbortController();
    this.#abort = abort;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled: () => void = () => {};

    // The race bounds the response wait; close() also tracks the underlying work.
    // Abort stops cooperative callbacks but is not proof a driver query stopped.
    this.#pending = Promise.resolve().then(() => this.#authorize(abort.signal));
    const stopped = new Promise<never>((_resolve, reject) => {
      cancelled = () => reject(new Error("Authorization check stopped"));
      abort.signal.addEventListener("abort", cancelled, { once: true });
      timer = setTimeout(() => abort.abort(), Math.max(0, deadline - Date.now()));
      timer.unref();
    });

    try {
      const allowed = await Promise.race([this.#pending, stopped]);
      if (this.#closed) return;

      if (Date.now() >= deadline) throw new Error("Authorization check expired");
      if (!allowed) throw new HttpError(403, "forbidden");

      // A slow successful query must not extend a stale decision's lifetime.
      this.#expiresAt = started + this.#intervalMs + this.#timeoutMs;
      this.#timer = setTimeout(() => {
        if (!this.valid) {
          this.#onInvalid();
          return;
        }

        void this.#check().catch(() => this.#onInvalid());
      }, Math.max(0, started + this.#intervalMs - Date.now()));
      this.#timer.unref();
    } catch (error) {
      if (this.#closed) return;
      if (error instanceof HttpError) throw error;

      throw new HttpError(503, "streamAuthorizationUnavailable", {
        code: "STREAM_AUTHORIZATION_UNAVAILABLE",
        defaultMessage: "Log stream authorization could not be verified",
      });
    } finally {
      clearTimeout(timer);
      abort.signal.removeEventListener("abort", cancelled);
    }
  }
}
