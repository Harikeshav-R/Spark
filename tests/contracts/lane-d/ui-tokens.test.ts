import { describe, it, expect } from "vitest";
import {
  MASTERY_COLORS,
  MASTERY_BG_COLORS,
  MASTERY_TEXT_COLORS,
} from "../../../src/components/ui/badge.js";
import { confidenceToBand } from "../../../src/contracts/mastery.js";
import type { MasteryBand } from "../../../src/contracts/common.js";

function parseHex(hex: string): [number, number, number] {
  const cleanHex = hex.replace("#", "");
  return [
    parseInt(cleanHex.substring(0, 2), 16) / 255,
    parseInt(cleanHex.substring(2, 4), 16) / 255,
    parseInt(cleanHex.substring(4, 6), 16) / 255,
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((val) => {
    return val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function calculateContrastRatio(hex1: string, hex2: string): number {
  const [r1, g1, b1] = parseHex(hex1);
  const [r2, g2, b2] = parseHex(hex2);
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Lane D: UI Design Tokens & WCAG Contrast Invariants (P0-D-01)", () => {
  it("satisfies WCAG 2.1 AA text contrast (>= 4.5:1) for all soft badge pairs", () => {
    const bands: MasteryBand[] = ["gray", "red", "yellow", "green"];

    for (const band of bands) {
      const bg = MASTERY_BG_COLORS[band];
      const text = MASTERY_TEXT_COLORS[band];
      const ratio = calculateContrastRatio(bg, text);

      expect(
        ratio,
        `Expected ${band} soft badge contrast between ${bg} and ${text} to be >= 4.5:1, got ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("satisfies WCAG 2.1 AA text contrast (>= 4.5:1) for solid mastery fills with designated text", () => {
    const solidForegrounds: Record<MasteryBand, string> = {
      gray: "#2b2a2e", // ink
      red: "#fffdf8", // panel
      yellow: "#2b2a2e", // ink
      green: "#fffdf8", // panel
    };
    const bands: MasteryBand[] = ["gray", "red", "yellow", "green"];

    for (const band of bands) {
      const fill = MASTERY_COLORS[band];
      const text = solidForegrounds[band];
      const ratio = calculateContrastRatio(fill, text);

      expect(
        ratio,
        `Expected ${band} solid fill contrast between ${fill} and ${text} to be >= 4.5:1, got ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("maps confidence values to bands in accordance with SC-01 regression scenario", () => {
    const input = [0.0, 0.3999, 0.4, 0.6999, 0.7, 1.0];
    const expectedBands: MasteryBand[] = ["gray", "red", "yellow", "yellow", "green", "green"];

    const mapped = input.map(confidenceToBand);
    expect(mapped).toEqual(expectedBands);
  });
});
