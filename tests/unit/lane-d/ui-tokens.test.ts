import { describe, it, expect } from "vitest";
import {
  MASTERY_PALETTE,
  ACTIVE_CONCEPT_RING,
  calculateRelativeLuminance,
  calculateContrastRatio,
  isWcagAaCompliant,
  formatMasteryLabel,
  getMasteryTokens,
  type MasteryBand,
} from "../../../src/components/ui/tokens.js";

describe("Lane D: UI Component Tokens & WCAG Contrast (P0-D-01)", () => {
  const bands: MasteryBand[] = ["gray", "red", "yellow", "green"];

  describe("1. Canonical Mastery Palette Structure & Invariants", () => {
    it("defines all four canonical mastery bands", () => {
      expect(Object.keys(MASTERY_PALETTE).sort()).toEqual(
        ["gray", "green", "red", "yellow"].sort()
      );
    });

    it("matches exact base colors defined in docs/09-frontend.md section 3.2", () => {
      expect(MASTERY_PALETTE.gray.baseHex).toBe("#9CA3AF");
      expect(MASTERY_PALETTE.red.baseHex).toBe("#EF4444");
      expect(MASTERY_PALETTE.yellow.baseHex).toBe("#F59E0B");
      expect(MASTERY_PALETTE.green.baseHex).toBe("#10B981");
    });

    it("defines active concept glowing amber ring color", () => {
      expect(ACTIVE_CONCEPT_RING).toBe("#F59E0B");
    });

    it("provides explicit text alternatives for color-blind accessibility", () => {
      for (const band of bands) {
        const config = MASTERY_PALETTE[band];
        expect(config.textAlternative).toBeTruthy();
        expect(typeof config.textAlternative).toBe("string");
        expect(config.name).toBeTruthy();
      }
    });
  });

  describe("2. Relative Luminance & Contrast Math (WCAG 2.1)", () => {
    it("calculates relative luminance for pure black (#000000) and pure white (#FFFFFF)", () => {
      const blackLum = calculateRelativeLuminance("#000000");
      const whiteLum = calculateRelativeLuminance("#FFFFFF");

      expect(blackLum).toBeCloseTo(0.0, 4);
      expect(whiteLum).toBeCloseTo(1.0, 4);
    });

    it("calculates standard contrast ratio between white and black as 21:1", () => {
      const cr = calculateContrastRatio("#FFFFFF", "#000000");
      expect(cr).toBeCloseTo(21.0, 1);
    });

    it("returns 1:1 contrast for identical colors", () => {
      const cr = calculateContrastRatio("#10B981", "#10B981");
      expect(cr).toBeCloseTo(1.0, 2);
    });

    it("rejects invalid hex strings with descriptive errors", () => {
      expect(() => calculateRelativeLuminance("#xyz")).toThrow();
      expect(() => calculateRelativeLuminance("invalid")).toThrow();
    });
  });

  describe("3. WCAG 2.1 AA Contrast Compliance for All Mastery Bands", () => {
    it("ensures softText on softBg exceeds WCAG 2.1 AA requirement (>= 4.5:1)", () => {
      for (const band of bands) {
        const config = MASTERY_PALETTE[band];
        const ratio = calculateContrastRatio(config.softText, config.softBg);
        expect(
          ratio,
          `Band ${band} softText (${config.softText}) on softBg (${config.softBg}) failed AA contrast: ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);

        expect(isWcagAaCompliant(config.softText, config.softBg)).toBe(true);
      }
    });

    it("ensures solidText on solidBg exceeds WCAG 2.1 AA requirement (>= 4.5:1)", () => {
      for (const band of bands) {
        const config = MASTERY_PALETTE[band];
        const ratio = calculateContrastRatio(config.solidText, config.solidBg);
        expect(
          ratio,
          `Band ${band} solidText (${config.solidText}) on solidBg (${config.solidBg}) failed AA contrast: ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);

        expect(isWcagAaCompliant(config.solidText, config.solidBg)).toBe(true);
      }
    });

    it("ensures softText on pure white (#FFFFFF) background exceeds WCAG 2.1 AA", () => {
      for (const band of bands) {
        const config = MASTERY_PALETTE[band];
        const ratio = calculateContrastRatio(config.softText, "#FFFFFF");
        expect(
          ratio,
          `Band ${band} softText on white background failed AA contrast: ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  describe("4. Helper Functions & Token Retrieval", () => {
    it("formats mastery labels with percentage and name", () => {
      expect(formatMasteryLabel(0.0)).toBe("Unattempted (0%)");
      expect(formatMasteryLabel(0.25)).toBe("Needs Practice (25%)");
      expect(formatMasteryLabel(0.55)).toBe("Developing (55%)");
      expect(formatMasteryLabel(0.85)).toBe("Mastered (85%)");
    });

    it("retrieves tokens by band name or confidence scalar", () => {
      expect(getMasteryTokens("green").baseHex).toBe("#10B981");
      expect(getMasteryTokens(0.0).band).toBe("gray");
      expect(getMasteryTokens(0.3).band).toBe("red");
      expect(getMasteryTokens(0.6).band).toBe("yellow");
      expect(getMasteryTokens(0.95).band).toBe("green");
    });
  });
});
