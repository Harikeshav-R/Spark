"use client";

import React from "react";
import { motion } from "motion/react";
import type { PositionedNode } from "./d3-force-layout";

export interface AttentionConceptOverlayProps {
  attentionConceptIds: readonly string[];
  positionedNodes: ReadonlyMap<string, PositionedNode>;
  reducedMotion: boolean;
}

export function AttentionConceptOverlay({
  attentionConceptIds,
  positionedNodes,
  reducedMotion,
}: AttentionConceptOverlayProps): React.JSX.Element | null {
  const attentionNodes: PositionedNode[] = [];
  const seen = new Set<string>();

  for (const id of attentionConceptIds) {
    if (!seen.has(id)) {
      seen.add(id);
      const posNode = positionedNodes.get(id);
      if (posNode) {
        attentionNodes.push(posNode);
      }
    }
  }

  if (attentionNodes.length === 0) {
    return null;
  }

  return (
    <g className="attention-concept-overlay-layer" pointerEvents="none" aria-hidden="true">
      {attentionNodes.map((node) => (
        <g
          key={node.id}
          data-attention-concept-id={node.id}
          transform={`translate(${node.x}, ${node.y})`}
          pointerEvents="none"
        >
          {/* Steady base crimson ring */}
          <circle
            r="38"
            fill="none"
            stroke="var(--color-bad, #b0384a)"
            strokeWidth="3"
            pointerEvents="none"
          />

          {/* Concentric pulsing ring (omitted when reduced motion is preferred) */}
          {!reducedMotion && (
            <motion.circle
              r="38"
              fill="none"
              stroke="var(--color-bad, #b0384a)"
              strokeWidth="3"
              pointerEvents="none"
              initial={{ scale: 1, opacity: 0.85 }}
              animate={{
                scale: [1, 1.14, 1],
                opacity: [0.85, 0.25, 0.85],
              }}
              transition={{
                duration: 2.2,
                ease: "easeInOut",
                repeat: Infinity,
              }}
              style={{ transformOrigin: "0 0" }}
            />
          )}
        </g>
      ))}
    </g>
  );
}
