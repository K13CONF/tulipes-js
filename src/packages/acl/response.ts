/**
 * The unified response contract.
 *
 * Every endpoint returns the same envelope — for success and error alike — so
 * clients can rely on one shape. Handlers send it through `res.respond()`
 * (attached by the `responder` middleware); errors flow through thrown
 * `HttpError`s, which the central error handler renders into the same envelope.
 *
 * This file is just the contract (types + a pure builder). The runtime wiring
 * lives in `lib/responder.ts`.
 */
import type { Response } from "express"

/** A single error in the unified envelope. */
export interface ErrorEntry {
    /** Stable, machine-readable code, e.g. "FORBIDDEN". */
    code: string
    /** Human-readable, localized message. */
    message: string
    /** Optional field path, e.g. for validation errors ("body.name"). */
    path?: string
}

/** Pagination block carried in `meta` for list responses. */
export interface PaginationMeta {
    page?: number
    limit?: number
    total?: number
    totalPages?: number
}

/** Response metadata: pagination, a domain `action`, plus any extra keys. */
export interface ResponseMeta {
    pagination?: PaginationMeta
    action?: string
    [key: string]: unknown
}

/** The single shape every endpoint returns. */
export interface UnifiedEnvelope<Data = unknown> {
    isOk: boolean
    data: Data | null
    errors: ErrorEntry[]
    meta: ResponseMeta
}

/** Options accepted by `res.respond()`. */
export interface RespondOptions {
    /** HTTP status code (default 200). */
    status?: number
    /** Metadata (pagination, action, …). */
    meta?: ResponseMeta
}

/** `res.respond(data, options)` — convenience sender for the unified envelope. */
export type Responder = <Data = unknown>(data?: Data, options?: RespondOptions) => void

/** Builds a unified envelope, filling in the empty defaults. */
export function buildEnvelope<Data = unknown>(parts: {
    isOk: boolean
    data?: Data | null | undefined
    errors?: ErrorEntry[] | undefined
    meta?: ResponseMeta | undefined
}): UnifiedEnvelope<Data> {
    return {
        isOk: parts.isOk,
        data: parts.data ?? null,
        errors: parts.errors ?? [],
        meta: parts.meta ?? {},
    }
}

/**
 * The response handlers receive: the full Express `Response`, unchanged, plus
 * `res.respond()` (added via global augmentation). Nothing is restricted —
 * `res.json` / `res.send` / `res.status()` all keep working; `res.respond()` is
 * just the convenience for the unified envelope.
 */
export type AppResponse<Data = unknown, Locals extends Record<string, any> = Record<string, any>> =
    Response<Data, Locals>
