/** Fabrique du client LLM selon le provider configuré. */
import type { LlmClient, Provider } from "./types.ts";
import { geminiClient } from "./gemini.ts";
import { anthropicClient } from "./anthropic.ts";
import { openaiClient } from "./openai.ts";

export type { LlmClient, Provider, ChatTurn, TokenUsage } from "./types.ts";
export { MaxTokensError } from "./types.ts";

export function getLlm(provider: Provider, apiKey: string, model: string): LlmClient {
  switch (provider) {
    case "anthropic":
      return anthropicClient(apiKey, model);
    case "openai":
      return openaiClient(apiKey, model);
    default:
      return geminiClient(apiKey, model);
  }
}
