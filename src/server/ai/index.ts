export {
  OpenRouterClient,
  type OpenRouterClientOptions,
  type OpenRouterCompletionRequest,
  type AiCapability,
  type ModelTier,
  type CapabilityPolicy,
  AI_CAPABILITIES,
  CAPABILITY_POLICIES,
  DEFAULT_MODELS,
} from "./providers/openrouter-client.js";

export { SocraticTutorAi } from "./tutoring-ai.js";
export { fixtureSocraticTutorTurn } from "./fixtures/tutoring-turn.js";
