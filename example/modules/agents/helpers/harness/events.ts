import type { RunEvents, StepEvent } from "./contracts.ts";

/**
 * Sends each step to every sink — the log line, the run's timeline, a
 * socket — and never lets a failing sink stop the run: observability is
 * not allowed to change what the harness does.
 */
export class FanOutEvents implements RunEvents {
  readonly #sinks: readonly RunEvents[];
  readonly #onSinkError: (error: unknown, event: StepEvent) => void;

  constructor(sinks: readonly RunEvents[], onSinkError: (error: unknown, event: StepEvent) => void = () => {}) {
    this.#sinks = sinks;
    this.#onSinkError = onSinkError;
  }

  async emit(event: StepEvent): Promise<void> {
    await Promise.all(this.#sinks.map(async (sink) => {
      try {
        await sink.emit(event);
      } catch (error) {
        this.#onSinkError(error, event);
      }
    }));
  }
}
