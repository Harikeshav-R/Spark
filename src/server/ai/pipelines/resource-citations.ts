import { remark } from "remark";
import type { Node, Parent, Text } from "mdast";
import { z } from "zod";
import { AppError, DomainErrorCode } from "../../../contracts/errors.js";

const publicUrlSchema = z.url();

export function isResourceUrl(value: string): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  if (!publicUrlSchema.safeParse(value).success) {
    return false;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return false;
    }
    if (parsed.username || parsed.password) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isParent(node: Node): node is Parent {
  return "children" in node && Array.isArray((node as Parent).children);
}

function extractTextNodes(node: Node): string[] {
  if (node.type === "code" || node.type === "inlineCode" || node.type === "definition") {
    return [];
  }
  if (node.type === "text") {
    return [(node as Text).value];
  }
  if (isParent(node)) {
    const texts: string[] = [];
    for (const child of node.children) {
      texts.push(...extractTextNodes(child));
    }
    return texts;
  }
  return [];
}

export function getResourceCitationNumbers(answer: string): number[] {
  if (typeof answer !== "string" || answer.trim().length === 0) {
    return [];
  }

  const tree = remark().parse(answer);
  const textChunks = extractTextNodes(tree);
  const seen = new Set<number>();
  const numbers: number[] = [];
  const markerRegex = /\[(-?\d+)\]/g;

  for (const chunk of textChunks) {
    let match: RegExpExecArray | null;
    while ((match = markerRegex.exec(chunk)) !== null) {
      const num = Number(match[1]);
      if (!Number.isInteger(num) || num <= 0) {
        throw new AppError({
          code: DomainErrorCode.BAD_GATEWAY,
          statusCode: 502,
          message: "Resource answer contains invalid or ungrounded citations",
        });
      }
      if (!seen.has(num)) {
        seen.add(num);
        numbers.push(num);
      }
    }
  }

  return numbers;
}
