import type { SparkForm } from "../../contracts/index.js";

export type SparkMood = "calm" | "think" | "cheer" | "oops" | "sleepy";

/**
 * Returns the evolutionary Spark mascot form corresponding to whole-course sky brightness.
 * Follows domain invariant INV-XP08:
 * - ember: [0.0, 0.25)
 * - spark: [0.25, 0.55)
 * - glow:  [0.55, 0.75)
 * - nova:  [0.75, 1.0]
 *
 * @throws {RangeError} if skyBrightness is not a finite number in [0.0, 1.0].
 */
export function getSparkForm(skyBrightness: number): SparkForm {
  if (
    typeof skyBrightness !== "number" ||
    !Number.isFinite(skyBrightness) ||
    skyBrightness < 0 ||
    skyBrightness > 1
  ) {
    throw new RangeError("skyBrightness must be a finite number between 0 and 1");
  }

  if (skyBrightness < 0.25) {
    return "ember";
  }
  if (skyBrightness < 0.55) {
    return "spark";
  }
  if (skyBrightness < 0.75) {
    return "glow";
  }
  return "nova";
}

export const SPARK_FORM_LABELS: Readonly<Record<SparkForm, string>> = {
  ember: "Ember",
  spark: "Spark",
  glow: "Glow",
  nova: "Nova",
} as const;

export interface SparkSparkleDefinition {
  readonly cx: number;
  readonly cy: number;
  readonly size: number;
}

export interface SparkMoodDefinition {
  readonly label: string;
  readonly leftEye: string;
  readonly rightEye: string;
  readonly mouth: string;
  readonly brow?: string;
  readonly sparkles?: ReadonlyArray<SparkSparkleDefinition>;
}

/**
 * Fixed facial feature geometry for Spark across all five mood states.
 * Fixed face anchors:
 * - Left eye:  (53, 72)
 * - Right eye: (79, 72)
 * - Mouth:     centered at (66, 87)
 */
export const SPARK_MOODS: Readonly<Record<SparkMood, Readonly<SparkMoodDefinition>>> = {
  calm: {
    label: "calm",
    leftEye:
      "M 49.5 72 C 49.5 68.5 51 67.5 53 67.5 C 55 67.5 56.5 68.5 56.5 72 C 56.5 75.5 55 76.5 53 76.5 C 51 76.5 49.5 75.5 49.5 72 Z",
    rightEye:
      "M 75.5 72 C 75.5 68.5 77 67.5 79 67.5 C 81 67.5 82.5 68.5 82.5 72 C 82.5 75.5 81 76.5 79 76.5 C 77 76.5 75.5 75.5 75.5 72 Z",
    mouth: "M 59 86 C 62 89.5 70 89.5 73 86",
  },
  think: {
    label: "think",
    leftEye: "M 49 73 C 51 69.5 55 69.5 57 73",
    rightEye: "M 75 73 C 77 69.5 81 69.5 83 73",
    brow: "M 48 64 C 51 61.5 55 62 58 64.5 M 74 64.5 C 77 62 81 61.5 84 64",
    mouth: "M 62 87 C 65 89 69 88.5 71 86.5",
  },
  cheer: {
    label: "cheer",
    leftEye: "M 48 74 C 49 68 57 68 58 74",
    rightEye: "M 74 74 C 75 68 83 68 84 74",
    mouth: "M 56 84 C 60 92 72 92 76 84",
    sparkles: [
      { cx: 32, cy: 36, size: 8 },
      { cx: 100, cy: 32, size: 9 },
      { cx: 66, cy: 12, size: 8 },
    ],
  },
  oops: {
    label: "oops",
    leftEye:
      "M 49.5 72 C 49.5 68.5 51 67.5 53 67.5 C 55 67.5 56.5 68.5 56.5 72 C 56.5 75.5 55 76.5 53 76.5 C 51 76.5 49.5 75.5 49.5 72 Z",
    rightEye:
      "M 75.5 72 C 75.5 68.5 77 67.5 79 67.5 C 81 67.5 82.5 68.5 82.5 72 C 82.5 75.5 81 76.5 79 76.5 C 77 76.5 75.5 75.5 75.5 72 Z",
    brow: "M 48 62 C 51 59 55 61 58 64 M 74 66 C 77 64 81 65 84 67",
    mouth: "M 61 87 C 64 89.5 68 89.5 71 87",
  },
  sleepy: {
    label: "sleepy",
    leftEye: "M 49 71 C 51 74.5 55 74.5 57 71",
    rightEye: "M 75 71 C 77 74.5 81 74.5 83 71",
    mouth: "M 63 87 C 65 88.2 67 88.2 69 87",
  },
} as const;
