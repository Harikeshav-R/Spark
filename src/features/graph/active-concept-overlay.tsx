"use client";

import React from "react";
import { motion } from "motion/react";
import type { PositionedNode } from "./d3-force-layout";

export interface ActiveConceptOverlayProps {
  activeConceptIds: readonly string[];
  positionedNodes: ReadonlyMap<string, PositionedNode>;
  reducedMotion: boolean;
}

export function ActiveConceptOverlay({
  activeConceptIds,
  positionedNodes,
  reducedMotion,
}: ActiveConceptOverlayProps): React.JSX.Element | null {
  // Deduplicate and filter to valid positioned nodes
  const activeNodes: PositionedNode[] = [];
  const seen = new Set<string>();

  for (const id of activeConceptIds) {
    if (!seen.has(id)) {
      seen.add(id);
      const posNode = positionedNodes.get(id);
      if (posNode) {
        activeNodes.push(posNode);
      }
    }
  }

  if (activeNodes.length === 0) {
    return null;
  }

  return (
    <g className="active-concept-overlay-layer" pointerEvents="none" aria-hidden="true">
      {activeNodes.map((node) => (
        <g
          key={node.id}
          data-concept-id={node.id}
          transform={`translate(${node.x}, ${node.y})`}
          pointerEvents="none"
        >
          {/* Steady base ring */}
          <circle
            r="38"
            fill="none"
            stroke="var(--color-active-concept)"
            strokeWidth="3"
            pointerEvents="none"
          />

          {/* Concentric pulsing ring (omitted when reduced motion is preferred) */}
          {!reducedMotion && (
            <motion.circle
              r="38"
              fill="none"
              stroke="var(--color-active-concept)"
              strokeWidth="3"
              pointerEvents="none"
              initial={{ scale: 1, opacity: 0.85 }}
              animate={{
                scale: [1, 1.12, 1],
                opacity: [0.85, 0.35, 0.85],
              }}
              transition={{
                duration: 2,
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
