import type { ServiceRequestContext } from "../capabilities";
import {
  MODEL_LIMITS,
  type ModelErrorCode,
} from "../application/model-contracts";
import { createAdapterHttp, checkAdapterHttpResponse } from "./adapter-http";

export function modelRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Model limits and classifications remain owned by the existing model boundary. */
export function createModelHttp(
  context: ServiceRequestContext,
  failure: (code: ModelErrorCode, retryAfterMs?: number) => Error,
) {
  return createAdapterHttp(context, MODEL_LIMITS.maxDeadlineMs, failure);
}

export const checkModelHttpResponse = checkAdapterHttpResponse;
