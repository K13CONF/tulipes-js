/** One deadline for the whole shutdown; every step is attempted despite failures. */
export class Cleanup {
  readonly #deadline: number;
  readonly errors: Error[] = [];

  constructor(timeoutMs: number) {
    this.#deadline = Date.now() + timeoutMs;
  }

  async run(name: string, action: () => unknown | Promise<unknown>, force?: () => unknown): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(action),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`${name} timed out`)), Math.max(1, this.#deadline - Date.now()));
        }),
      ]);
    } catch (error) {
      this.errors.push(new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));
      if (force) await this.run(`${name} forced cleanup`, force);
    } finally {
      clearTimeout(timer);
    }
  }

  finish(): void {
    if (this.errors.length) {
      throw new AggregateError(this.errors, `Shutdown failed — ${this.errors.map(error => error.message).join("; ")}`);
    }
  }
}
