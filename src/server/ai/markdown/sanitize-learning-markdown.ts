import { remark } from "remark";
import remarkMath from "remark-math";
import type {
  Definition,
  Image,
  ImageReference,
  Link,
  LinkReference,
  Node,
  Parent,
  Root,
  Text,
} from "mdast";

function isParent(node: Node): node is Parent {
  return "children" in node && Array.isArray((node as Parent).children);
}

function isDefinition(node: Node): node is Definition {
  return node.type === "definition";
}

function isLink(node: Node): node is Link {
  return node.type === "link";
}

function isImage(node: Node): node is Image {
  return node.type === "image";
}

function isLinkReference(node: Node): node is LinkReference {
  return node.type === "linkReference";
}

function isImageReference(node: Node): node is ImageReference {
  return node.type === "imageReference";
}

function isSafeUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") {
    return false;
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizeLearningMarkdown(content: string): string {
  if (typeof content !== "string" || content.trim().length === 0) {
    return "";
  }

  const processor = remark().use(remarkMath);
  const tree = processor.parse(content) as Root;

  const safeDefinitions = new Map<string, boolean>();

  function collectDefinitions(node: Node): void {
    if (isDefinition(node)) {
      safeDefinitions.set(node.identifier.toLowerCase(), isSafeUrl(node.url));
    }
    if (isParent(node)) {
      for (const child of node.children) {
        collectDefinitions(child);
      }
    }
  }

  collectDefinitions(tree);

  function transformNode(node: Node): Node[] {
    if ("data" in node) {
      Reflect.deleteProperty(node, "data");
    }

    if (node.type === "html") {
      return [];
    }

    if (isDefinition(node)) {
      const isSafe = safeDefinitions.get(node.identifier.toLowerCase()) ?? false;
      if (!isSafe) {
        return [];
      }
      return [node];
    }

    if (isLink(node)) {
      if (!isSafeUrl(node.url)) {
        return node.children.flatMap((c) => transformNode(c));
      }
    }

    if (isImage(node)) {
      if (!isSafeUrl(node.url)) {
        const textNode: Text = {
          type: "text",
          value: node.alt ?? "",
        };
        return [textNode];
      }
    }

    if (isLinkReference(node)) {
      const isSafe = safeDefinitions.get(node.identifier.toLowerCase()) ?? false;
      if (!isSafe) {
        return node.children.flatMap((c) => transformNode(c));
      }
    }

    if (isImageReference(node)) {
      const isSafe = safeDefinitions.get(node.identifier.toLowerCase()) ?? false;
      if (!isSafe) {
        const textNode: Text = {
          type: "text",
          value: node.alt ?? "",
        };
        return [textNode];
      }
    }

    if (isParent(node)) {
      node.children = node.children.flatMap((c) => transformNode(c)) as typeof node.children;
    }

    return [node];
  }

  const [sanitizedTree] = transformNode(tree);
  if (!sanitizedTree) {
    return "";
  }

  return processor.stringify(sanitizedTree as Root).trim();
}
