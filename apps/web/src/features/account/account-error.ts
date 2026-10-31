import { ServiceClientError } from "../../../../../packages/navigation-core/service-client";
import { SavedDataClientError } from "../../../../../packages/navigation-core/saved-data-client";

/** Account views never echo private response bodies or arbitrary exception text. */
export function accountError(
  error: unknown,
  fallback = "This request could not be completed. Try again when you are ready.",
) {
  if (error instanceof SavedDataClientError) {
    switch (error.code) {
      case "ACCOUNT_CHANGED":
      case "SIGN_IN_REQUIRED":
        return "Open your account again before continuing. Local guidance is still available.";
      case "PREVIEW_CHANGED":
        return "The selected data changed. Review a new preview before saving.";
      case "CONFLICT":
        return "This item changed elsewhere. Review the current version before saving again.";
      case "CACHE_LIMIT":
        return "Review pending cloud changes before loading more saved items.";
      case "INVALID_ROUTE":
        return "This saved item cannot be used as a destination.";
    }
  }
  if (error instanceof ServiceClientError) {
    switch (error.code) {
      case "UNAUTHENTICATED":
        return "Sign in again before continuing. Local guidance is still available.";
      case "FORBIDDEN":
        return "Your account does not have access to this action. Review its permissions or choose another item.";
      case "CONFLICT":
      case "IDEMPOTENCY_CONFLICT":
        return "This item changed elsewhere. Refresh it before trying again.";
      case "NOT_FOUND":
        return "This item is no longer available. Refresh the page to review your current items.";
      case "RATE_LIMITED":
        return "Too many requests were made. Wait a moment before trying again.";
      case "QUOTA_EXHAUSTED":
      case "QUOTA_EXCEEDED":
        return "The current allowance is exhausted. You can still review, export or delete saved data.";
      case "UNAVAILABLE":
        return "This service is currently unavailable. Your local guidance remains available.";
      case "CANCELLED":
      case "DEADLINE_EXCEEDED":
        return "This request was interrupted. Review its status before trying again.";
      case "INVALID_RESPONSE":
      case "COMPATIBILITY_MISMATCH":
        return "This version cannot use that service response. Refresh your account or contact support.";
    }
  }
  return fallback;
}
