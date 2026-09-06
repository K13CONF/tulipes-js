import type { Request } from "express";

/**
 * What `?page` and `?per_page` asked for, clamped to the app's bounds.
 *
 * `skip` is computed here rather than in every handler, because the
 * off-by-one in `(page - 1) * per_page` is the kind of thing that gets
 * written correctly nine times and wrongly once.
 */
export interface PageRequest {
  page: number;
  per_page: number;
  /** Documents to skip — hand it straight to `.skip()`. */
  skip: number;
}

export interface PaginationBounds {
  defaultLimit?: number;
  maxLimit?: number;
}

/**
 * Bounds come from `config.pagination`, so one place decides how many rows
 * a caller may ask for and no endpoint can be talked into ten thousand.
 */
export function parsePage(req: Request, bounds: PaginationBounds = {}): PageRequest {
  const { defaultLimit = 20, maxLimit = 100 } = bounds;

  const page = positive(req.query?.page, 1);
  const asked = positive(req.query?.per_page, defaultLimit);
  const per_page = Math.min(asked, maxLimit);

  return { page, per_page, skip: (page - 1) * per_page };
}

/**
 * A non-numeric, zero, negative or fractional value falls back to the
 * default rather than failing the request: a bad `?page=abc` is a client
 * being sloppy about a parameter it did not have to send at all.
 */
function positive(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
