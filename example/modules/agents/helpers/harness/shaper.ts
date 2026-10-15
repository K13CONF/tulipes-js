import type { ResultFormatter, ToolOutcome } from "./contracts.ts";

/**
 * What a tool result costs the context. A result is sent as compact JSON;
 * past the cap a list keeps the items that fit and a value is cut, and
 * either way the model is told what was left out and how to ask for less —
 * a bare cut-off would read as the whole answer.
 */
export class ResultShaper implements ResultFormatter {
  readonly #maxChars: number;

  constructor(maxChars: number) {
    this.#maxChars = maxChars;
  }

  shape(outcome: ToolOutcome): string {
    if (!outcome.ok) return this.#cut(outcome.message);
    const data = outcome.data === undefined ? null : outcome.data;
    const text = typeof data === "string" ? data : JSON.stringify(data);
    if (text.length <= this.#maxChars) return text;
    const list = listOf(data);
    return list ? this.#fitList(list.items, list.wrap) : this.#cut(text);
  }

  #fitList(items: readonly unknown[], wrap: (kept: unknown[]) => unknown): string {
    // Grow the kept prefix while it fits, leaving room for the notice.
    const budget = this.#maxChars - 200;
    let kept = 0;
    let size = 2;
    for (const item of items) {
      const next = JSON.stringify(item).length + 1;
      if (size + next > budget) break;
      size += next;
      kept++;
    }
    const shown = JSON.stringify(wrap(items.slice(0, kept)));
    return `${shown}\n[${kept} of ${items.length} items shown: the result was too long. Ask for fewer — a filter, a smaller page or a narrower tool — rather than repeating this call.]`;
  }

  #cut(text: string): string {
    if (text.length <= this.#maxChars) return text;
    const keep = Math.max(0, this.#maxChars - 200);
    return `${text.slice(0, keep)}\n[${keep} of ${text.length} characters shown: the result was too long. Ask for less — a filter, a smaller page or a narrower tool — rather than repeating this call.]`;
  }
}

/** A list result, bare or as the envelope-style `{ items: [...] }` an action may return. */
function listOf(data: unknown): { items: unknown[]; wrap: (kept: unknown[]) => unknown } | undefined {
  if (Array.isArray(data)) return { items: data, wrap: (kept) => kept };
  if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    const arrays = entries.filter(([, value]) => Array.isArray(value));
    if (arrays.length === 1) {
      const [key, value] = arrays[0]!;
      return { items: value as unknown[], wrap: (kept) => ({ ...(data as Record<string, unknown>), [key]: kept }) };
    }
  }
  return undefined;
}
