import type { ConceptNode } from "../../../contracts/course.js";

export async function fixtureSocraticTutorTurn(
  concept: ConceptNode,
  _messageHistory: { role: "user" | "assistant"; content: string }[],
  newStudentMessage: string
): Promise<{ assistantResponse: string; understandingDetected: boolean }> {
  const messageLower = newStudentMessage.toLowerCase();
  const understandingDetected =
    messageLower.includes("chain rule") ||
    messageLower.includes("activation") ||
    messageLower.includes("local gradient") ||
    messageLower.includes("intermediate");

  const assistantResponse = understandingDetected
    ? "Outstanding breakthrough! You've connected how intermediate activations and the chain rule propagate local derivatives to weights."
    : `Let's consider ${concept.label}. When we compute the parameter updates backwards, how do intermediate activations contribute to the chain rule?`;

  return { assistantResponse, understandingDetected };
}
