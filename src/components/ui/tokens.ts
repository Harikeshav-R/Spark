/**
 * UI Design Tokens for Mastery Bands & Accessibility
 *
 * Adheres to:
 * - docs/03-invariants.md (INV-M02: Canonical Mastery Bands)
 * - docs/09-frontend.md (Section 3.2 Visual Styling & Section 4 Accessibility)
 * - WCAG 2.1 AA contrast requirements (>= 4.5:1 normal text, >= 3.0:1 large/graphical)
 */

import {
  type MasteryBand,
  confidenceToBand,
} from "../../contracts/index.js";

export type { MasteryBand };

export interface MasteryColorConfig {
  band: MasteryBand;
  name: string;
  description: string;
  /** Base hex color for D3-force graph nodes (from docs/09-frontend.md) */
  baseHex: string;
  /** Soft background color for badges and alerts */
  softBg: string;
  /** High-contrast text color on soft background (WCAG AAA >= 7:1) */
  softText: string;
  /** Border color for badges and cards */
  border: string;
  /** Solid background color for buttons and badges */
  solidBg: string;
  /** High-contrast text color on solid background (WCAG AA >= 4.5:1) */
  solidText: string;
  /** Focus and active state accent ring */
  accentRing: string;
  /** Minimum confidence threshold (inclusive) */
  minConfidence: number;
  /** Maximum confidence threshold (exclusive, except 1.0) */
  maxConfidence: number;
  /** Accessible status label for color-blind users (WCAG 2.1 AA) */
  textAlternative: string;
}

export const MASTERY_PALETTE: Record<MasteryBand, MasteryColorConfig> = {
  gray: {
    band: "gray",
    name: "Unattempted",
    description: "Confidence c = 0.0",
    baseHex: "#9CA3AF",
    softBg: "#F3F4F6",
    softText: "#1F2937",
    border: "#D1D5DB",
    solidBg: "#4B5563",
    solidText: "#FFFFFF",
    accentRing: "#9CA3AF",
    minConfidence: 0.0,
    maxConfidence: 0.0,
    textAlternative: "Unattempted (0%)",
  },
  red: {
    band: "red",
    name: "Needs Practice",
    description: "Confidence 0.0 < c < 0.40",
    baseHex: "#EF4444",
    softBg: "#FEF2F2",
    softText: "#991B1B",
    border: "#FCA5A5",
    solidBg: "#DC2626",
    solidText: "#FFFFFF",
    accentRing: "#EF4444",
    minConfidence: 0.0,
    maxConfidence: 0.4,
    textAlternative: "Needs Practice (<40%)",
  },
  yellow: {
    band: "yellow",
    name: "Developing",
    description: "Confidence 0.40 <= c < 0.70",
    baseHex: "#F59E0B",
    softBg: "#FFFBEB",
    softText: "#78350F",
    border: "#FCD34D",
    solidBg: "#F59E0B",
    solidText: "#000000",
    accentRing: "#F59E0B",
    minConfidence: 0.4,
    maxConfidence: 0.7,
    textAlternative: "Developing (40%-70%)",
  },
  green: {
    band: "green",
    name: "Mastered",
    description: "Confidence c >= 0.70",
    baseHex: "#10B981",
    softBg: "#ECFDF5",
    softText: "#065F46",
    border: "#6EE7B7",
    solidBg: "#047857",
    solidText: "#FFFFFF",
    accentRing: "#10B981",
    minConfidence: 0.7,
    maxConfidence: 1.0,
    textAlternative: "Mastered (>=70%)",
  },
};

/**
 * Active concept glowing amber ring color (docs/09-frontend.md section 3.2)
 */
export const ACTIVE_CONCEPT_RING = "#F59E0B";

/**
 * Calculate sRGB channel relative luminance according to WCAG 2.1 specification.
 */
export function calculateChannelLuminance(channelValue: number): number {
  const c = channelValue / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Calculate relative luminance for a given hex color string (#RRGGBB).
 */
export function calculateRelativeLuminance(hexColor: string): number {
  const sanitized = hexColor.replace("#", "").trim();
  if (sanitized.length !== 6) {
    throw new Error(`Invalid hex color: ${hexColor}. Expected 6 hex digits.`);
  }

  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    throw new Error(`Invalid hex channel values in color: ${hexColor}`);
  }

  return (
    0.2126 * calculateChannelLuminance(r) +
    0.7152 * calculateChannelLuminance(g) +
    0.0722 * calculateChannelLuminance(b)
  );
}

/**
 * Calculate WCAG 2.1 contrast ratio between two hex colors.
 * Returns ratio as a scalar >= 1.0 (e.g. 4.5 for 4.5:1).
 */
export function calculateContrastRatio(hex1: string, hex2: string): number {
  const lum1 = calculateRelativeLuminance(hex1);
  const lum2 = calculateRelativeLuminance(hex2);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Validates if color pair meets WCAG 2.1 AA requirements.
 * - Normal text: >= 4.5:1
 * - Large text or graphical elements: >= 3.0:1
 */
export function isWcagAaCompliant(
  foregroundHex: string,
  backgroundHex: string,
  isLargeText = false
): boolean {
  const ratio = calculateContrastRatio(foregroundHex, backgroundHex);
  const threshold = isLargeText ? 3.0 : 4.5;
  return ratio >= threshold;
}

/**
 * Formats a confidence value into a percentage label with mastery text alternative.
 */
export function formatMasteryLabel(confidence: number): string {
  const band = confidenceToBand(confidence);
  const percent = Math.round(confidence * 100);
  const config = MASTERY_PALETTE[band];
  return `${config.name} (${percent}%)`;
}

/**
 * Retrieves mastery color configuration for a given band or confidence score.
 */
export function getMasteryTokens(
  bandOrConfidence: MasteryBand | number
): MasteryColorConfig {
  const band: MasteryBand =
    typeof bandOrConfidence === "number"
      ? confidenceToBand(bandOrConfidence)
      : bandOrConfidence;
  return MASTERY_PALETTE[band];
}
