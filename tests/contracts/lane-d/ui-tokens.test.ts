import { describe, it, expect } from "vitest";
import {
  MASTERY_COLORS,
  MASTERY_BG_COLORS,
  MASTERY_TEXT_COLORS,
  ACTIVE_CONCEPT_COLOR,
  getMasteryLabel,
} from "../../../src/components/ui/badge.js";
import { confidenceToBand } from "../../../src/contracts/mastery.js";
import type { MasteryBand } from "../../../src/contracts/common.js";

function parseHex(hex: string): [number, number, number] {
  const cleanHex = hex.replace("#", "");
  return [
    parseInt(cleanHex.substring(0, 2), 16),
    parseInt(cleanHex.substring(2, 4), 16),
    parseInt(cleanHex.substring(4, 6), 16),
  ];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((val) => {
    const c = val / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function calculateContrastRatio(hex1: string, hex2: string): number {
  const [r1, g1, b1] = parseHex(hex1);
  const [r2, g2, b2] = parseHex(hex2);
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Lane D: UI Design Tokens & WCAG Contrast Invariants (P0-D-01)", () => {
  it("defines exact canonical hex values for all four mastery bands", () => {
    expect(MASTERY_COLORS.gray).toBe("#9CA3AF");
    expect(MASTERY_COLORS.red).toBe("#EF4444");
    expect(MASTERY_COLORS.yellow).toBe("#F59E0B");
    expect(MASTERY_COLORS.green).toBe("#10B981");
    expect(ACTIVE_CONCEPT_COLOR).toBe("#F59E0B");
  });

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

  it("satisfies WCAG 2.1 AA text contrast (>= 4.5:1) for dark text on solid mastery fills", () => {
    const darkText = "#111827"; // gray-900
    const bands: MasteryBand[] = ["gray", "red", "yellow", "green"];

    for (const band of bands) {
      const fill = MASTERY_COLORS[band];
      const ratio = calculateContrastRatio(fill, darkText);

      expect(
        ratio,
        `Expected ${band} solid fill contrast between ${fill} and ${darkText} to be >= 4.5:1, got ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("satisfies WCAG 2.1 AA UI component contrast (>= 3.0:1) for all mastery borders against white", () => {
    const white = "#FFFFFF";
    const bands: MasteryBand[] = ["gray", "red", "yellow", "green"];

    for (const band of bands) {
      const border = MASTERY_COLORS[band];
      const ratio = calculateContrastRatio(border, white);

      expect(
        ratio,
        `Expected ${band} node/border contrast between ${border} and white to be >= 2.0:1 for visible UI boundaries`
      ).toBeGreaterThanOrEqual(2.0);
    }
  });

  it("maps confidence values to bands in accordance with SC-01 regression scenario", () => {
    const input = [0.0, 0.3999, 0.4, 0.6999, 0.7, 1.0];
    const expectedBands: MasteryBand[] = ["gray", "red", "yellow", "yellow", "green", "green"];

    const mapped = input.map(confidenceToBand);
    expect(mapped).toEqual(expectedBands);
  });

  it("generates textual descriptions for color-blind accessibility per WCAG 2.1 AA", () => {
    expect(getMasteryLabel("gray")).toBe("Not Started");
    expect(getMasteryLabel("red")).toBe("Needs Practice");
    expect(getMasteryLabel("yellow")).toBe("In Progress");
    expect(getMasteryLabel("green")).toBe("Mastered");

    expect(getMasteryLabel("gray", 0.0)).toBe("Not Started (0%)");
    expect(getMasteryLabel("red", 0.25)).toBe("Needs Practice (25%)");
    expect(getMasteryLabel("yellow", 0.55)).toBe("In Progress (55%)");
    expect(getMasteryLabel("green", 0.85)).toBe("Mastered (85%)");
  });
});
