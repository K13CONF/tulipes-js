import type { Model, PipelineStage, PopulateOptions, RootFilterQuery } from "mongoose";

import type { ParsedListQuery } from "../policy.ts";
import {
  groupSortStage,
  groupStages,
  matchStage,
  pageStages,
  projectStage,
  resolveStage,
  sortStage,
  treeCountStages,
  treeSortStage,
  treeStages,
} from "./stages.ts";

/**
 * The parsed query, compiled for Mongoose. Two shapes, because the two
 * modes are different operations: a plain list is a `find` (lean, with
 * populate), a grouped list is an aggregation. Both start from the same
 * match and read the same sort rules, so a filter means the same thing in
 * either.
 */
export type CompiledQuery =
  | {
      mode: "list";
      match: RootFilterQuery<unknown>;
      sort: Record<string, 1 | -1>;
      project?: Record<string, 1>;
      populate: PopulateOptions[];
      skip: number;
      limit: number;
      count: boolean;
      maxTimeMS: number;
    }
  | {
      mode: "group";
      pipeline: PipelineStage[];
      count?: PipelineStage[];
      maxTimeMS: number;
    };

export interface CompileOptions {
  /** ANDed outside everything the client sent; it cannot be widened or overridden. */
  system?: RootFilterQuery<unknown>;
  /** Per query. Default 5 000 ms. */
  maxTimeMS?: number;
}

const DEFAULT_MAX_TIME_MS = 5_000;

export function toMongoose(
  query: ParsedListQuery,
  page: { skip: number; per_page: number },
  options: CompileOptions = {},
): CompiledQuery {
  const match = matchStage(query, options.system);
  const maxTimeMS = options.maxTimeMS ?? DEFAULT_MAX_TIME_MS;
  const counted = query.policy.count !== false;

  if (query.group.length === 0) {
    const project = projectStage(query);
    return {
      mode: "list",
      match,
      sort: sortStage(query),
      ...(project && { project }),
      populate: resolveStage(query.resolve, query.policy.resolve),
      skip: page.skip,
      limit: page.per_page,
      count: counted,
      maxTimeMS,
    };
  }

  const first: PipelineStage = { $match: match };
  if (query.tree) {
    return {
      mode: "group",
      pipeline: [first, ...treeStages(query), { $sort: treeSortStage(query) }, ...pageStages(page)],
      ...(counted && { count: [first, ...treeCountStages(query)] }),
      maxTimeMS,
    };
  }
  const [bucket] = groupStages(query);
  return {
    mode: "group",
    pipeline: [first, ...groupStages(query), { $sort: groupSortStage(query) }, ...pageStages(page)],
    ...(counted && { count: [first, bucket!, { $count: "total" }] }),
    maxTimeMS,
  };
}

export interface QueryResult<T> {
  data: T[];
  /** Absent when the policy turned counting off. */
  total_items?: number;
}

/** Runs a compiled query: the page and its total in parallel. */
export async function runQuery<T = Record<string, unknown>>(model: Model<any>, compiled: CompiledQuery): Promise<QueryResult<T>> {
  return compiled.mode === "list" ? runList<T>(model, compiled) : runGrouped<T>(model, compiled);
}

async function runList<T>(model: Model<any>, compiled: Extract<CompiledQuery, { mode: "list" }>): Promise<QueryResult<T>> {
  const find = model
    .find(compiled.match)
    .sort(compiled.sort)
    .skip(compiled.skip)
    .limit(compiled.limit)
    .maxTimeMS(compiled.maxTimeMS);
  if (compiled.project) find.select(compiled.project);
  if (compiled.populate.length) find.populate(compiled.populate);

  const [data, total_items] = await Promise.all([
    find.lean<T[]>(),
    compiled.count ? model.countDocuments(compiled.match).maxTimeMS(compiled.maxTimeMS) : undefined,
  ]);
  return { data, ...(total_items !== undefined && { total_items }) };
}

async function runGrouped<T>(model: Model<any>, compiled: Extract<CompiledQuery, { mode: "group" }>): Promise<QueryResult<T>> {
  const [data, counted] = await Promise.all([
    model.aggregate<T>(compiled.pipeline).option({ maxTimeMS: compiled.maxTimeMS }),
    compiled.count ? model.aggregate<{ total: number }>(compiled.count).option({ maxTimeMS: compiled.maxTimeMS }) : undefined,
  ]);
  return { data, ...(counted && { total_items: counted[0]?.total ?? 0 }) };
}
