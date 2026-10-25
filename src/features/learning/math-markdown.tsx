"use client";

import React, { useMemo } from "react";
import { remark } from "remark";
import remarkMath from "remark-math";
import katex from "katex";
import "katex/dist/katex.min.css";
import type {
  Root,
  Node,
  Parent,
  Definition,
  Heading,
  List,
  ListItem,
  Link,
  LinkReference,
  Code,
  InlineCode,
  Text,
} from "mdast";

interface MathNode extends Node {
  type: "math" | "inlineMath";
  value: string;
}

const processor = remark().use(remarkMath);

// Simple bounded cache for parsed ASTs and definitions
interface CachedParsedAst {
  tree: Root;
  definitions: Map<string, string>;
}

const astCache = new Map<string, CachedParsedAst>();
const MAX_CACHE_SIZE = 500;

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

function parseAndIndex(content: string): CachedParsedAst {
  const cached = astCache.get(content);
  if (cached) {
    return cached;
  }

  const tree = processor.parse(content) as Root;
  const definitions = new Map<string, string>();

  function collectDefinitions(node: Node): void {
    if (node.type === "definition") {
      const def = node as Definition;
      definitions.set(def.identifier.toLowerCase(), def.url);
    }
    if ("children" in node && Array.isArray((node as Parent).children)) {
      for (const child of (node as Parent).children) {
        collectDefinitions(child);
      }
    }
  }

  collectDefinitions(tree);

  if (astCache.size >= MAX_CACHE_SIZE) {
    const firstKey = astCache.keys().next().value;
    if (firstKey !== undefined) {
      astCache.delete(firstKey);
    }
  }

  const result: CachedParsedAst = { tree, definitions };
  astCache.set(content, result);
  return result;
}

function renderMath(expression: string, displayMode: boolean): string {
  return katex.renderToString(expression, {
    displayMode,
    output: "htmlAndMathml",
    trust: false,
    throwOnError: false,
    maxExpand: 1000,
    maxSize: 20,
  });
}

export function MathMarkdown({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}): React.JSX.Element {
  const { tree, definitions } = useMemo(() => parseAndIndex(content), [content]);

  function renderNodes(nodes: Node[], keyPrefix: string): React.ReactNode[] {
    return nodes.map((node, index) => renderNode(node, `${keyPrefix}-${index}`));
  }

  function renderNode(node: Node, key: string): React.ReactNode {
    switch (node.type) {
      case "root":
        return <div key={key}>{renderNodes((node as Root).children, key)}</div>;

      case "paragraph":
        return (
          <p key={key} className="my-2 leading-relaxed text-[#2b2a2e]">
            {renderNodes((node as Parent).children, key)}
          </p>
        );

      case "heading": {
        const headingNode = node as Heading;
        const depth = headingNode.depth;
        const children = renderNodes(headingNode.children, key);
        const headingClasses = [
          "font-semibold text-[#1f1e24] my-3 tracking-tight",
          depth === 1 ? "text-2xl border-b border-[#e6d8bd] pb-2 font-serif" : "",
          depth === 2 ? "text-xl border-b border-[#ebdcc0] pb-1 font-serif" : "",
          depth === 3 ? "text-lg font-serif" : "",
          depth >= 4 ? "text-base font-serif" : "",
        ]
          .filter(Boolean)
          .join(" ");

        switch (depth) {
          case 1:
            return <h1 key={key} className={headingClasses}>{children}</h1>;
          case 2:
            return <h2 key={key} className={headingClasses}>{children}</h2>;
          case 3:
            return <h3 key={key} className={headingClasses}>{children}</h3>;
          case 4:
            return <h4 key={key} className={headingClasses}>{children}</h4>;
          case 5:
            return <h5 key={key} className={headingClasses}>{children}</h5>;
          case 6:
            return <h6 key={key} className={headingClasses}>{children}</h6>;
          default:
            return <p key={key} className="font-semibold text-[#1f1e24] my-2">{children}</p>;
        }
      }

      case "emphasis":
        return (
          <em key={key} className="italic">
            {renderNodes((node as Parent).children, key)}
          </em>
        );

      case "strong":
        return (
          <strong key={key} className="font-semibold text-[#1f1e24]">
            {renderNodes((node as Parent).children, key)}
          </strong>
        );

      case "list": {
        const listNode = node as List;
        const children = renderNodes(listNode.children, key);
        if (listNode.ordered) {
          return (
            <ol key={key} start={listNode.start ?? 1} className="my-2 ml-5 list-decimal space-y-1 text-[#2b2a2e]">
              {children}
            </ol>
          );
        }
        return (
          <ul key={key} className="my-2 ml-5 list-disc space-y-1 text-[#2b2a2e]">
            {children}
          </ul>
        );
      }

      case "listItem": {
        const itemNode = node as ListItem;
        return (
          <li key={key} className="leading-relaxed">
            {renderNodes(itemNode.children, key)}
          </li>
        );
      }

      case "blockquote":
        return (
          <blockquote
            key={key}
            className="my-3 border-l-4 border-[#c87a32] bg-[#fbf5ec] pl-4 py-2 italic text-[#4a4742]"
          >
            {renderNodes((node as Parent).children, key)}
          </blockquote>
        );

      case "break":
        return <br key={key} />;

      case "thematicBreak":
        return <hr key={key} className="my-4 border-[#e6d8bd]" />;

      case "inlineCode": {
        const inlineCodeNode = node as InlineCode;
        return (
          <code
            key={key}
            className="rounded bg-[#f0e4cf] px-1.5 py-0.5 font-mono text-xs text-[#8f3910]"
          >
            {inlineCodeNode.value}
          </code>
        );
      }

      case "code": {
        const codeNode = node as Code;
        if (codeNode.lang === "math") {
          const renderedHtml = renderMath(codeNode.value, true);
          return (
            <div
              key={key}
              role="math"
              aria-label="Display math block"
              className="my-3 overflow-x-auto rounded-lg border border-[#e6d8bd] bg-[#fffdf8] px-4 py-3 text-center text-[#2b2a2e] shadow-xs"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          );
        }
        return (
          <pre
            key={key}
            className="my-3 overflow-x-auto rounded-lg border border-[#e6d8bd] bg-[#242426] p-3 text-xs text-[#f7f5f0]"
          >
            <code className="font-mono">{codeNode.value}</code>
          </pre>
        );
      }

      case "link": {
        const linkNode = node as Link;
        const children = renderNodes(linkNode.children, key);
        if (isSafeUrl(linkNode.url)) {
          return (
            <a
              key={key}
              href={linkNode.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#a9481a] underline hover:text-[#883610]"
              title={linkNode.title ?? undefined}
            >
              {children}
            </a>
          );
        }
        return <React.Fragment key={key}>{children}</React.Fragment>;
      }

      case "linkReference": {
        const refNode = node as LinkReference;
        const children = renderNodes(refNode.children, key);
        const resolvedUrl = definitions.get(refNode.identifier.toLowerCase());
        if (resolvedUrl && isSafeUrl(resolvedUrl)) {
          return (
            <a
              key={key}
              href={resolvedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#a9481a] underline hover:text-[#883610]"
            >
              {children}
            </a>
          );
        }
        return <React.Fragment key={key}>{children}</React.Fragment>;
      }

      case "math": {
        const mathNode = node as MathNode;
        const renderedHtml = renderMath(mathNode.value, true);
        return (
          <div
            key={key}
            role="math"
            aria-label="Display math"
            className="my-3 overflow-x-auto rounded-lg border border-[#e6d8bd] bg-[#fffdf8] px-4 py-3 text-center text-[#2b2a2e] shadow-xs"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        );
      }

      case "inlineMath": {
        const inlineMathNode = node as MathNode;
        const renderedHtml = renderMath(inlineMathNode.value, false);
        return (
          <span
            key={key}
            role="math"
            aria-label="Inline math"
            className="inline-block px-0.5"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        );
      }

      case "text": {
        const textNode = node as Text;
        return <React.Fragment key={key}>{textNode.value}</React.Fragment>;
      }

      // Explicitly drop raw HTML, images, and definitions from output
      case "html":
      case "image":
      case "imageReference":
      case "definition":
      case "footnoteDefinition":
      case "footnoteReference":
        return null;

      default:
        if ("children" in node && Array.isArray((node as Parent).children)) {
          return <React.Fragment key={key}>{renderNodes((node as Parent).children, key)}</React.Fragment>;
        }
        return null;
    }
  }

  return (
    <div className={`prose-sm max-w-none text-[#2b2a2e] ${className}`}>
      {renderNodes(tree.children, "root")}
    </div>
  );
}
