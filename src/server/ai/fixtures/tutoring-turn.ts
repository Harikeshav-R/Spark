import type { ConceptNode } from "../../../contracts/course.js";

export async function fixtureSocraticTutorTurn(
  concept: ConceptNode,
  _messageHistory: { role: "user" | "assistant"; content: string }[],
  newStudentMessage: string
): Promise<{ assistantResponse: string; understandingDetected: boolean }> {
  const normalizedLabel = concept.label.trim().toLowerCase();
  const messageLower = newStudentMessage.toLowerCase().replace(/\s+/g, " ").trim();

  if (normalizedLabel === "derivatives") {
    const isSupportedDerivativeAnswer =
      messageLower ===
        "a derivative is the instantaneous rate of change: the limit of the difference quotient as the input change approaches zero." ||
      (messageLower.includes("instantaneous rate of change") &&
        messageLower.includes("difference quotient") &&
        messageLower.includes("approaches zero"));

    if (isSupportedDerivativeAnswer) {
      return {
        assistantResponse: "How would you explain that limiting rate of change for a different function in your own words?",
        understandingDetected: true,
      };
    }

    return {
      assistantResponse: "How could the slope between two nearby points describe a function's rate of change as those points move closer?",
      understandingDetected: false,
    };
  }

  const understandingDetected =
    messageLower.includes("chain rule") ||
    messageLower.includes("activation") ||
    messageLower.includes("local gradient") ||
    messageLower.includes("intermediate");

  const assistantResponse = understandingDetected
    ? "How could you use that reasoning to trace a small change through a different network?"
    : `Let's consider ${concept.label}. When we compute the parameter updates backwards, how do intermediate activations contribute to the chain rule?`;

  return { assistantResponse, understandingDetected };
}
