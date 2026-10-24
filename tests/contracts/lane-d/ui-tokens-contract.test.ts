import { describe, it, expect } from "vitest";
import {
  masteryBandSchema,
  confidenceSchema,
  confidenceToBand,
  type MasteryBand,
} from "../../../src/contracts/index.js";
import {
  MASTERY_PALETTE,
  getMasteryTokens,
  formatMasteryLabel,
  isWcagAaCompliant,
  Button,
  Card,
  Badge,
  Modal,
} from "../../../src/components/ui/index.js";

describe("Lane D: UI Component Tokens Contract Compliance (P0-D-01)", () => {
  const allBands: MasteryBand[] = ["gray", "red", "yellow", "green"];

  it("exports all frozen UI primitives produced in P0-D-01", () => {
    expect(Button).toBeDefined();
    expect(Card).toBeDefined();
    expect(Badge).toBeDefined();
    expect(Modal).toBeDefined();
    expect(MASTERY_PALETTE).toBeDefined();
  });

  it("conforms to masteryBandSchema for all palette keys", () => {
    for (const key of Object.keys(MASTERY_PALETTE)) {
      expect(masteryBandSchema.safeParse(key).success).toBe(true);
    }
    for (const band of allBands) {
      expect(MASTERY_PALETTE[band]).toBeDefined();
      expect(MASTERY_PALETTE[band].band).toBe(band);
    }
  });

  it("conforms to confidenceToBand domain invariant (INV-M02)", () => {
    // 0.0 -> gray
    expect(confidenceSchema.safeParse(0.0).success).toBe(true);
    expect(confidenceToBand(0.0)).toBe("gray");
    expect(getMasteryTokens(0.0).band).toBe("gray");

    // 0.2 -> red
    expect(confidenceSchema.safeParse(0.2).success).toBe(true);
    expect(confidenceToBand(0.2)).toBe("red");
    expect(getMasteryTokens(0.2).band).toBe("red");

    // 0.5 -> yellow
    expect(confidenceSchema.safeParse(0.5).success).toBe(true);
    expect(confidenceToBand(0.5)).toBe("yellow");
    expect(getMasteryTokens(0.5).band).toBe("yellow");

    // 0.85 -> green
    expect(confidenceSchema.safeParse(0.85).success).toBe(true);
    expect(confidenceToBand(0.85)).toBe("green");
    expect(getMasteryTokens(0.85).band).toBe("green");
  });

  it("guarantees WCAG 2.1 AA compliance for every mapped confidence score", () => {
    const testPoints = [0.0, 0.1, 0.25, 0.39, 0.4, 0.55, 0.69, 0.7, 0.85, 1.0];
    for (const score of testPoints) {
      const tokens = getMasteryTokens(score);
      expect(isWcagAaCompliant(tokens.softText, tokens.softBg)).toBe(true);
      expect(isWcagAaCompliant(tokens.solidText, tokens.solidBg)).toBe(true);
      expect(formatMasteryLabel(score)).toContain("%");
    }
  });
});
