/** Exact source-owned destinations. Neither stored connections nor clients choose a URL. */
export const CUSTOMER_PROVIDER_ENDPOINTS = Object.freeze({
  openai: "https://api.openai.com/v1/responses",
  anthropic: "https://api.anthropic.com/v1/messages",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
} as const);

export const CUSTOMER_PROVIDER_COUNT_ENDPOINTS = Object.freeze({
  openai: "https://api.openai.com/v1/responses/input_tokens",
  anthropic: "https://api.anthropic.com/v1/messages/count_tokens",
} as const);
