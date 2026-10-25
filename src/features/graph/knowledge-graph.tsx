"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { cn } from "../../lib/client/utils";
import {
  computeGraphLayout,
  getPrerequisitePath,
  validateKnowledgeGraph,
  type GraphData,
  type PositionedNode,
} from "./d3-force-layout";
import { StarVessel, getStatusText } from "./star-vessel";
import { ActiveConceptOverlay } from "./active-concept-overlay";
export interface KnowledgeGraphProps {
  graph: GraphData;
  className?: string;
  activeConceptIds?: readonly string[];
}

const DEFAULT_ACTIVE_CONCEPT_IDS: readonly string[] = [];

function captureGraphPointer(element: SVGSVGElement, pointerId: number): void {
  if (typeof element.setPointerCapture !== "function") {
    return;
  }
  try {
    if (
      typeof element.hasPointerCapture === "function" &&
      element.hasPointerCapture(pointerId)
    ) {
      return;
    }
    element.setPointerCapture(pointerId);
  } catch (error: unknown) {
    console.warn("[KnowledgeGraph] Pointer capture failed", {
      operation: "set",
      pointerId,
      error,
    });
  }
}

function releaseGraphPointer(element: SVGSVGElement, pointerId: number): void {
  if (
    typeof element.hasPointerCapture !== "function" ||
    typeof element.releasePointerCapture !== "function"
  ) {
    return;
  }
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch (error: unknown) {
    console.warn("[KnowledgeGraph] Pointer capture failed", {
      operation: "release",
      pointerId,
      error,
    });
  }
}

export function KnowledgeGraph({
  graph,
  className,
  activeConceptIds = DEFAULT_ACTIVE_CONCEPT_IDS,
}: KnowledgeGraphProps): React.JSX.Element {
  // 1. Invariant and empty validations (run during SSR as well)
  if (graph.nodes.length === 0) {
    return (
      <div
        className={cn(
          "p-8 text-center text-muted bg-paper-panel rounded-lg border border-paper-line",
          className
        )}
      >
        No concepts to display.
      </div>
    );
  }

  const validation = validateKnowledgeGraph(graph);
  if (!validation.valid) {
    return (
      <div
        role="alert"
        className={cn(
          "p-6 bg-paper-panel rounded-lg border border-bad text-ink space-y-2",
          className
        )}
      >
        <div className="font-semibold text-bad">
          Unable to display this knowledge graph.
        </div>
        <p className="text-sm text-muted">{validation.reason}</p>
      </div>
    );
  }

  // 2. Client environment state
  const [mounted, setMounted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const activePointers = useRef(
    new Map<number, { clientX: number; clientY: number }>()
  );
  const dragStart = useRef<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
    pinchDist?: number;
    pinchZoom?: number;
  }>({ clientX: 0, clientY: 0, panX: 0, panY: 0 });
  const hasMovedRef = useRef(false);

  const reactId = useId();
  const safeReactId = reactId.replace(/[^a-zA-Z0-9-_]/g, "");
  const defaultMarkerId = `arrow-marker-${safeReactId}-default`;
  const highlightMarkerId = `arrow-marker-${safeReactId}-highlight`;

  // Measure container and subscribe to prefers-reduced-motion
  useEffect(() => {
    setMounted(true);

    if (typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReducedMotion(mediaQuery.matches);

      const handleMotionChange = (e: MediaQueryListEvent) => {
        setReducedMotion(e.matches);
      };

      mediaQuery.addEventListener("change", handleMotionChange);
      return () => {
        mediaQuery.removeEventListener("change", handleMotionChange);
      };
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0) {
            setContainerWidth(entry.contentRect.width);
          }
        }
      });
      ro.observe(containerRef.current);
      return () => ro.disconnect();
    } else {
      setContainerWidth(containerRef.current.clientWidth || 800);
      const onResize = () => {
        if (containerRef.current) {
          setContainerWidth(containerRef.current.clientWidth || 800);
        }
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
  }, []);

  // Quick lookup maps
  const nodeMap = useMemo(() => {
    return new Map(graph.nodes.map((n) => [n.id, n]));
  }, [graph.nodes]);

  // If selectedId no longer exists in graph, clear effective selection
  const effectiveSelectedId = useMemo(() => {
    return selectedId && nodeMap.has(selectedId) ? selectedId : null;
  }, [selectedId, nodeMap]);

  // Compute prerequisite path for selection
  const { nodeIds: ancestorNodeIds, edgeIds: ancestorEdgeIds } = useMemo(() => {
    if (!effectiveSelectedId) {
      return { nodeIds: new Set<string>(), edgeIds: new Set<string>() };
    }
    return getPrerequisitePath(graph, effectiveSelectedId);
  }, [graph, effectiveSelectedId]);

  // Layout is memoized on graph, logical width, and reduced motion
  const logicalWidth = Math.max(640, containerWidth ?? 640);
  const layout = useMemo(() => {
    return computeGraphLayout(graph, { width: logicalWidth, reducedMotion });
  }, [graph, logicalWidth, reducedMotion]);

  const positionedNodeMap = useMemo(() => {
    return new Map(layout.nodes.map((n) => [n.id, n]));
  }, [layout.nodes]);

  // Direct incoming prerequisite map
  const directPrereqMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of graph.nodes) {
      map.set(node.id, []);
    }
    for (const edge of graph.edges) {
      const list = map.get(edge.target) ?? [];
      const srcNode = nodeMap.get(edge.source);
      if (srcNode) {
        list.push(srcNode.label);
      }
      map.set(edge.target, list);
    }
    return map;
  }, [graph.nodes, graph.edges, nodeMap]);

  // Bounding box with 96px padding
  const fittedBounds = useMemo(() => {
    if (layout.nodes.length === 0) {
      return { x: 0, y: 0, width: 640, height: 480 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of layout.nodes) {
      minX = Math.min(minX, n.x - 80);
      maxX = Math.max(maxX, n.x + 80);
      minY = Math.min(minY, n.y - 30);
      maxY = Math.max(maxY, n.y + 75);
    }
    const PADDING = 96;
    return {
      x: minX - PADDING,
      y: minY - PADDING,
      width: Math.max(100, maxX - minX + PADDING * 2),
      height: Math.max(100, maxY - minY + PADDING * 2),
    };
  }, [layout.nodes]);

  const viewBox = useMemo(() => {
    const cx = fittedBounds.x + fittedBounds.width / 2;
    const cy = fittedBounds.y + fittedBounds.height / 2;
    const vw = fittedBounds.width / zoom;
    const vh = fittedBounds.height / zoom;
    const vx = cx - vw / 2 + pan.x;
    const vy = cy - vh / 2 + pan.y;
    return { x: vx, y: vy, width: vw, height: vh, string: `${vx} ${vy} ${vw} ${vh}` };
  }, [fittedBounds, zoom, pan]);

  // Handlers for selection, camera, and navigation
  const handleSelectNode = useCallback((id: string) => {
    if (hasMovedRef.current) return;
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleResetView = useCallback(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(4.0, z * 1.25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(0.5, z / 1.25));
  }, []);

  // Focusing an off-screen star pans it into the viewport without moving DOM focus
  const handleNodeFocus = useCallback(
    (node: PositionedNode) => {
      const cx = fittedBounds.x + fittedBounds.width / 2;
      const cy = fittedBounds.y + fittedBounds.height / 2;
      const margin = 50;

      const inView =
        node.x >= viewBox.x + margin &&
        node.x <= viewBox.x + viewBox.width - margin &&
        node.y >= viewBox.y + margin &&
        node.y <= viewBox.y + viewBox.height - margin;

      if (!inView) {
        setPan({ x: node.x - cx, y: node.y - cy });
      }
    },
    [fittedBounds, viewBox]
  );

  // Pointer drag and pinch gesture handlers
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    activePointers.current.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
    });
    hasMovedRef.current = false;

    if (activePointers.current.size === 1) {
      dragStart.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      // Only capture pointer immediately if clicking SVG background, not a button
      const isInteractive = (e.target as Element)?.closest?.('[role="button"]');
      if (!isInteractive) {
        captureGraphPointer(e.currentTarget, e.pointerId);
      }
    } else if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(
        pts[0].clientX - pts[1].clientX,
        pts[0].clientY - pts[1].clientY
      );
      dragStart.current = {
        clientX: (pts[0].clientX + pts[1].clientX) / 2,
        clientY: (pts[0].clientY + pts[1].clientY) / 2,
        panX: pan.x,
        panY: pan.y,
        pinchDist: dist,
        pinchZoom: zoom,
      };
      captureGraphPointer(e.currentTarget, e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, {
      clientX: e.clientX,
      clientY: e.clientY,
    });

    const svgRect = svgRef.current?.getBoundingClientRect();
    const svgW = svgRect?.width || fittedBounds.width;
    const svgH = svgRect?.height || fittedBounds.height;
    const scaleX = viewBox.width / svgW;
    const scaleY = viewBox.height / svgH;

    if (activePointers.current.size === 1) {
      const dx = e.clientX - dragStart.current.clientX;
      const dy = e.clientY - dragStart.current.clientY;

      if (Math.hypot(dx, dy) > 5) {
        hasMovedRef.current = true;
        captureGraphPointer(e.currentTarget, e.pointerId);
      }

      setPan({
        x: dragStart.current.panX - dx * scaleX,
        y: dragStart.current.panY - dy * scaleY,
      });
    } else if (activePointers.current.size === 2 && dragStart.current.pinchDist) {
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(
        pts[0].clientX - pts[1].clientX,
        pts[0].clientY - pts[1].clientY
      );

      if (Math.abs(dist - dragStart.current.pinchDist) > 5) {
        hasMovedRef.current = true;
      }

      const ratio = dist / dragStart.current.pinchDist;
      const nextZoom = Math.min(
        4.0,
        Math.max(0.5, (dragStart.current.pinchZoom ?? 1.0) * ratio)
      );
      setZoom(nextZoom);
    }
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<SVGSVGElement>) => {
    activePointers.current.delete(e.pointerId);
    releaseGraphPointer(e.currentTarget, e.pointerId);
    setTimeout(() => {
      hasMovedRef.current = false;
    }, 50);
  };

  const selectedNode = effectiveSelectedId ? nodeMap.get(effectiveSelectedId) : null;
  const ancestorCount = effectiveSelectedId
    ? Math.max(0, ancestorNodeIds.size - 1)
    : 0;

  const liveAnnouncement = selectedNode
    ? `Selected concept ${selectedNode.label}. ${ancestorCount} prerequisite concept${
        ancestorCount === 1 ? "" : "s"
      } highlighted.`
    : "Selection cleared.";

  // Concept details list component (shared between SSR preparation and interactive view)
  const conceptDetailsList = (
    <details className="group border border-paper-line rounded-lg bg-paper-panel p-4">
      <summary className="font-semibold text-sm text-ink cursor-pointer select-none">
        Concept details &amp; prerequisites ({graph.nodes.length})
      </summary>
      <div className="mt-4 space-y-3 divide-y divide-paper-line">
        {graph.nodes.map((node) => {
          const { statusText } = getStatusText(node);
          const prereqs = directPrereqMap.get(node.id) ?? [];
          const isSelected = effectiveSelectedId === node.id;
          const isAncestor = effectiveSelectedId
            ? ancestorNodeIds.has(node.id)
            : false;

          return (
            <div key={node.id} className="pt-3 first:pt-0">
              <button
                type="button"
                onClick={() => handleSelectNode(node.id)}
                className={cn(
                  "w-full text-left p-2.5 rounded transition-colors",
                  isSelected
                    ? "bg-[#ecdcc0] text-ink font-semibold"
                    : isAncestor
                    ? "bg-amber-50 text-ink"
                    : "hover:bg-paper-muted text-ink"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="font-medium text-sm">{node.label}</span>
                  <span className="text-xs text-muted font-normal">
                    {statusText}
                  </span>
                </div>
                <p className="text-xs text-charcoal mt-1 line-clamp-2">
                  {node.description}
                </p>
                <p className="text-[11px] text-muted mt-1">
                  Direct prerequisites: {prereqs.length > 0 ? prereqs.join(", ") : "None (Foundational)"}
                </p>
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );

  // SSR or initial mount preparation branch
  if (!mounted || containerWidth === null) {
    return (
      <div
        ref={containerRef}
        aria-busy="true"
        className={cn("space-y-4", className)}
      >
        <div className="p-8 text-center text-muted bg-paper-panel rounded-lg border border-paper-line">
          <p className="text-sm font-medium">Preparing knowledge graph…</p>
        </div>
        {conceptDetailsList}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("space-y-4", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setSelectedId(null);
        }
      }}
    >
      {/* Screen reader live announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted">
          Use <kbd className="px-1 py-0.5 rounded bg-paper-muted border border-paper-line text-[10px]">Tab</kbd> to traverse,{" "}
          <kbd className="px-1 py-0.5 rounded bg-paper-muted border border-paper-line text-[10px]">Enter</kbd> to select,{" "}
          <kbd className="px-1 py-0.5 rounded bg-paper-muted border border-paper-line text-[10px]">Esc</kbd> to clear.
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleZoomIn}
            disabled={zoom >= 4.0 - 0.001}
            aria-label="Zoom in"
          >
            Zoom in
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleZoomOut}
            disabled={zoom <= 0.5 + 0.001}
            aria-label="Zoom out"
          >
            Zoom out
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetView}
            aria-label="Reset view"
          >
            Reset view
          </Button>
          {effectiveSelectedId && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearSelection}
              aria-label="Clear selection"
            >
              Clear selection
            </Button>
          )}
        </div>
      </div>

      {/* Interactive SVG Viewport */}
      <div className="relative w-full h-[440px] md:h-[560px] rounded-lg border border-paper-line bg-paper overflow-hidden select-none">
        <svg
          ref={svgRef}
          viewBox={viewBox.string}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          style={{ touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUpOrCancel}
          onPointerCancel={handlePointerUpOrCancel}
        >
          <defs>
            <marker
              id={defaultMarkerId}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#c4b89e" />
            </marker>
            <marker
              id={highlightMarkerId}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#a9481a" />
            </marker>
          </defs>

          {/* Background prerequisite edges */}
          <g className="edges-layer">
            {graph.edges.map((edge) => {
              const src = positionedNodeMap.get(edge.source);
              const tgt = positionedNodeMap.get(edge.target);
              if (!src || !tgt) return null;

              const dx = tgt.x - src.x;
              const dy = tgt.y - src.y;
              const len = Math.hypot(dx, dy);
              if (len <= 48) return null;

              const ux = dx / len;
              const uy = dy / len;
              const x1 = src.x + ux * 24;
              const y1 = src.y + uy * 24;
              const x2 = tgt.x - ux * 24;
              const y2 = tgt.y - uy * 24;

              const isHighlighted = effectiveSelectedId
                ? ancestorEdgeIds.has(edge.id)
                : false;
              const isDimmed = effectiveSelectedId ? !isHighlighted : false;

              return (
                <line
                  key={edge.id}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isHighlighted ? "#a9481a" : "#c4b89e"}
                  strokeWidth={isHighlighted ? 3 : 1.5}
                  opacity={isDimmed ? 0.25 : 1}
                  markerEnd={`url(#${
                    isHighlighted ? highlightMarkerId : defaultMarkerId
                  })`}
                  className="transition-opacity duration-200"
                />
              );
            })}
          </g>

          {/* Active concept overlay rings */}
          <ActiveConceptOverlay
            activeConceptIds={activeConceptIds}
            positionedNodes={positionedNodeMap}
            reducedMotion={reducedMotion}
          />

          {/* Interactive Star Vessels (traversed in topological order) */}
          <g className="nodes-layer">
            {layout.nodes.map((posNode) => {
              const node = nodeMap.get(posNode.id);
              if (!node) return null;

              const isSelected = effectiveSelectedId === node.id;
              const isAncestor = effectiveSelectedId
                ? ancestorNodeIds.has(node.id)
                : false;
              const isDimmed = effectiveSelectedId ? !isAncestor : false;

              return (
                <g
                  key={node.id}
                  onFocus={() => handleNodeFocus(posNode)}
                >
                  <StarVessel
                    node={node}
                    x={posNode.x}
                    y={posNode.y}
                    selected={isSelected}
                    dimmed={isDimmed}
                    onSelect={handleSelectNode}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Selected concept card drawer */}
      {selectedNode && (
        <div
          role="region"
          aria-label="Selected concept details"
          className="p-4 bg-paper-panel rounded-lg border border-paper-line space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-ink text-base">
                {selectedNode.label}
              </h3>
              <p className="text-xs text-muted mt-0.5">
                Category: {selectedNode.category} • Difficulty: {selectedNode.difficulty}/5
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {getStatusText(selectedNode).statusText}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearSelection}
              >
                Close
              </Button>
            </div>
          </div>

          <p className="text-sm text-charcoal">{selectedNode.description}</p>

          <div>
            <span className="text-xs font-medium text-ink">
              Direct Prerequisites ({directPrereqMap.get(selectedNode.id)?.length || 0}):
            </span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(directPrereqMap.get(selectedNode.id)?.length || 0) > 0 ? (
                directPrereqMap.get(selectedNode.id)!.map((label) => (
                  <Badge key={label} variant="outline" className="text-xs">
                    {label}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted">
                  None (Foundational prerequisite)
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Expandable text alternative list */}
      {conceptDetailsList}
    </div>
  );
}
