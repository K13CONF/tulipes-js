/**
 * The one response shape. Every endpoint answers with it, success or
 * failure, so a client writes its unwrapping once:
 *
 *   { success, data, errors, meta }
 *
 * `data` is null on failure and `errors` is empty on success — never both
 * populated, never both empty.
 */

export interface ApiError {
  /** The offending input, or null for an error that belongs to no field. */
  field: string | null;
  /** Already translated, in the caller's locale. */
  message: string;
  /** Stable, machine-readable, and never translated: "NOT_FOUND". */
  code: string;
}

/**
 * What an app's `meta.action` may say — "complete_profile",
 * "redirect_to_signin". Augment it and the values become a closed set,
 * checked at every call site:
 *
 *   declare module "@tulipes/core/http" {
 *     interface MetaActions {
 *       complete_profile: true;
 *       redirect_to_signin: true;
 *     }
 *   }
 */
export interface MetaActions {}

/**
 * Any string until an app declares its actions, exactly those afterwards.
 * The conditional is what makes an un-augmented app compile without
 * declaring anything, and an augmented one reject a typo.
 */
export type MetaAction = keyof MetaActions extends never
  ? string
  : keyof MetaActions & string;

/**
 * Envelope metadata. Pagination keys appear only on a paginated response,
 * so a single-record `meta` stays `{}` rather than carrying five nulls.
 *
 * Augment this interface to add app-wide keys of your own.
 */
export interface ResponseMeta {
  /** What the client should do next, if anything. */
  action?: MetaAction;
  page?: number;
  per_page?: number;
  total_pages?: number;
  total_items?: number;
}

export interface Envelope<T = unknown> {
  success: boolean;
  data: T | null;
  errors: ApiError[];
  meta: ResponseMeta;
}

/**
 * A response body. `data` and `errors` are mutually exclusive in practice:
 * failures are thrown, so a handler calling `respond` is on the happy path
 * almost every time.
 */
export interface RespondOptions<T> {
  data?: T | null;
  errors?: ApiError[];
  meta?: ResponseMeta;
  /** Defaults to 200, or 400 when errors are present. */
  status?: number;
}

/**
 * Derives `total_pages` and fills page/per_page from what the request
 * asked for, so a list endpoint supplies only the count it had to query
 * for anyway.
 */
export function buildMeta(
  meta: ResponseMeta | undefined,
  page: { page: number; per_page: number } | undefined,
): ResponseMeta {
  // Pagination is opt-in per response: a handler signals "this is a page
  // of results" by passing total_items, and nothing else has to be said.
  if (meta?.total_items === undefined) return { ...meta };

  // The pagination keys are pulled OUT of the spread rather than
  // overwritten in it: re-assigning a key JavaScript has already seen
  // keeps its original position, so spreading first would leave them in
  // whatever order the handler happened to write.
  const {
    total_items,
    page: askedPage,
    per_page: askedPerPage,
    total_pages: askedTotalPages,
    ...rest
  } = meta;

  const per_page = askedPerPage ?? page?.per_page ?? total_items;

  return {
    ...rest,
    page: askedPage ?? page?.page ?? 1,
    per_page,
    total_pages: askedTotalPages ?? (per_page > 0 ? Math.ceil(total_items / per_page) : 0),
    total_items,
  };
}

export function envelope<T>(options: RespondOptions<T>, meta: ResponseMeta): Envelope<T> {
  const errors = options.errors ?? [];
  const success = errors.length === 0;

  return {
    success,
    // Never both: a failed response carries no data, whatever was passed.
    data: success ? (options.data ?? null) : null,
    errors,
    meta,
  };
}
