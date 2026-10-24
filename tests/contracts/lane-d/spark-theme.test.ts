import { describe, it, expect } from "vitest";
import {
  MASTERY_COLORS,
  MASTERY_BG_COLORS,
  MASTERY_TEXT_COLORS,
} from "../../../src/components/ui/badge.js";
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

describe("CP-P1-D-02: Spark Warm Theme & WCAG AA Contrast Verification", () => {
  it("satisfies WCAG 2.1 AA text contrast (>= 4.5:1) for all soft mastery band badge pairs", () => {
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

  it("satisfies WCAG 2.1 AA text contrast (>= 4.5:1) for solid mastery fills with designated foregrounds", () => {
    // Under warm palette: solid gray and yellow use ink (#2b2a2e); solid red and green use panel (#fffdf8)
    const solidForegrounds: Record<MasteryBand, string> = {
      gray: "#2b2a2e",
      red: "#fffdf8",
      yellow: "#2b2a2e",
      green: "#fffdf8",
    };
    const bands: MasteryBand[] = ["gray", "red", "yellow", "green"];

    for (const band of bands) {
      const fill = MASTERY_COLORS[band];
      const text = solidForegrounds[band];
      const ratio = calculateContrastRatio(fill, text);

      expect(
        ratio,
        `Expected ${band} solid badge contrast between ${fill} and ${text} to be >= 4.5:1, got ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("satisfies WCAG 2.1 AA body and button text contrast (>= 4.5:1)", () => {
    const ink = "#2b2a2e";
    const paper = "#faf6ee";
    const panel = "#fffdf8";
    const orange = "#ed793c";
    const bad = "#b0384a";

    // Ink on paper canvas
    const paperContrast = calculateContrastRatio(paper, ink);
    expect(paperContrast).toBeGreaterThanOrEqual(4.5);

    // Ink on panel surface
    const panelContrast = calculateContrastRatio(panel, ink);
    expect(panelContrast).toBeGreaterThanOrEqual(4.5);

    // Default button: ink on orange
    const buttonDefaultContrast = calculateContrastRatio(orange, ink);
    expect(buttonDefaultContrast).toBeGreaterThanOrEqual(4.5);

    // Destructive button: panel on bad
    const buttonDestructiveContrast = calculateContrastRatio(bad, panel);
    expect(buttonDestructiveContrast).toBeGreaterThanOrEqual(4.5);
  });

  it("satisfies WCAG 2.1 AA UI component contrast (>= 3.0:1) for control boundaries", () => {
    const charcoal = "#3a3a3d";
    const panel = "#fffdf8";
    const ratio = calculateContrastRatio(charcoal, panel);
    expect(ratio).toBeGreaterThanOrEqual(3.0);
  });
});
