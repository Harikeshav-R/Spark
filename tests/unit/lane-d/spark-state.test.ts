import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  getSparkForm,
  SPARK_MOODS,
  SPARK_FORM_LABELS,
  type SparkMood,
} from "../../../src/features/mascot/spark-moods.js";
import { SparkMascot } from "../../../src/features/mascot/spark-mascot.js";
import type { SparkForm } from "../../../src/contracts/index.js";

describe("Lane D: Spark Mascot Verification (P2-D-03 / CP-P2-D-03)", () => {
  describe("Domain Invariant INV-XP08: Form Boundaries & Validation", () => {
    it("maps brightness ranges to evolutionary forms accurately", () => {
      // Ember: [0.0, 0.25)
      expect(getSparkForm(0)).toBe("ember");
      expect(getSparkForm(0.1)).toBe("ember");
      expect(getSparkForm(0.2499)).toBe("ember");

      // Spark: [0.25, 0.55)
      expect(getSparkForm(0.25)).toBe("spark");
      expect(getSparkForm(0.4)).toBe("spark");
      expect(getSparkForm(0.5499)).toBe("spark");

      // Glow: [0.55, 0.75)
      expect(getSparkForm(0.55)).toBe("glow");
      expect(getSparkForm(0.65)).toBe("glow");
      expect(getSparkForm(0.7499)).toBe("glow");

      // Nova: [0.75, 1.0]
      expect(getSparkForm(0.75)).toBe("nova");
      expect(getSparkForm(0.9)).toBe("nova");
      expect(getSparkForm(1.0)).toBe("nova");
    });

    it("rejects nonfinite values and values outside [0, 1] with RangeError", () => {
      const expectedMessage = "skyBrightness must be a finite number between 0 and 1";

      expect(() => getSparkForm(NaN)).toThrow(RangeError);
      expect(() => getSparkForm(NaN)).toThrow(expectedMessage);

      expect(() => getSparkForm(Infinity)).toThrow(RangeError);
      expect(() => getSparkForm(-Infinity)).toThrow(RangeError);

      expect(() => getSparkForm(-0.01)).toThrow(RangeError);
      expect(() => getSparkForm(-1)).toThrow(RangeError);

      expect(() => getSparkForm(1.01)).toThrow(RangeError);
      expect(() => getSparkForm(2.0)).toThrow(RangeError);
    });
  });

  describe("Form and Mood Matrix: 20 Variations", () => {
    const moods: SparkMood[] = ["calm", "think", "cheer", "oops", "sleepy"];
    const forms: Array<{ form: SparkForm; brightness: number }> = [
      { form: "ember", brightness: 0.1 },
      { form: "spark", brightness: 0.4 },
      { form: "glow", brightness: 0.65 },
      { form: "nova", brightness: 0.9 },
    ];

    for (const { form, brightness } of forms) {
      for (const mood of moods) {
        it(`renders valid SVG for ${form} with mood ${mood}`, () => {
          const html = renderToString(
            React.createElement(SparkMascot, { skyBrightness: brightness, mood })
          );

          // SVG structure and accessibility
          expect(html).toContain("<svg");
          expect(html).toContain('role="img"');
          expect(html).toContain('focusable="false"');
          expect(html).toContain('viewBox="0 0 132 132"');
          expect(html).toContain(`data-form="${form}"`);
          expect(html).toContain(`data-mood="${mood}"`);

          // Accessible title formatting: "Spark — {Form}, {mood}"
          const expectedTitle = `Spark — ${SPARK_FORM_LABELS[form]}, ${SPARK_MOODS[mood].label}`;
          expect(html).toContain(`<title id="spark-title-`);
          expect(html).toContain(`>${expectedTitle}</title>`);

          // Ground shadow presence
          expect(html).toContain('class="spark-mascot-shadow"');

          // Facial feature presence
          expect(html).toContain('class="spark-mascot-face"');
          expect(html).toContain('class="spark-mascot-left-eye"');
          expect(html).toContain('class="spark-mascot-right-eye"');
          expect(html).toContain('class="spark-mascot-mouth"');
        });
      }
    }

    it("renders differing body and corona structures per form", () => {
      const emberHtml = renderToString(
        React.createElement(SparkMascot, { skyBrightness: 0.1, mood: "calm" })
      );
      const sparkHtml = renderToString(
        React.createElement(SparkMascot, { skyBrightness: 0.4, mood: "calm" })
      );
      const glowHtml = renderToString(
        React.createElement(SparkMascot, { skyBrightness: 0.65, mood: "calm" })
      );
      const novaHtml = renderToString(
        React.createElement(SparkMascot, { skyBrightness: 0.9, mood: "calm" })
      );

      // Ember has no rays and no crown, but has ember particle dots
      expect(emberHtml).not.toContain("spark-mascot-rays");
      expect(emberHtml).not.toContain("spark-mascot-crown");
      expect(emberHtml).toContain("spark-mascot-ember-particles");

      // Spark has 8 rays, no crown, no halo
      expect(sparkHtml).toContain("spark-mascot-rays");
      expect(sparkHtml.match(/<line/g)?.length).toBe(8);
      expect(sparkHtml).not.toContain("spark-mascot-crown");
      expect(sparkHtml).not.toContain("spark-mascot-halo-glow");

      // Glow has 12 rays, static halo, warm sparkles, but no crown
      expect(glowHtml).toContain("spark-mascot-rays");
      expect(glowHtml.match(/<line/g)?.length).toBe(12);
      expect(glowHtml).toContain("spark-mascot-halo-glow");
      expect(glowHtml).toContain("spark-mascot-glow-sparkles");
      expect(glowHtml).not.toContain("spark-mascot-crown");

      // Nova has 16 rays, broader halo, and three-point light crown
      expect(novaHtml).toContain("spark-mascot-rays");
      expect(novaHtml.match(/<line/g)?.length).toBe(16);
      expect(novaHtml).toContain("spark-mascot-halo-nova");
      expect(novaHtml).toContain("spark-mascot-crown");
    });

    it("renders distinct mood geometry and maintains non-shaming expression for oops", () => {
      const calmHtml = renderToString(
        React.createElement(SparkMascot, { skyBrightness: 0.5, mood: "calm" })
      );
      const thinkHtml = renderToString(
        React.createElement(SparkMascot, { skyBrightness: 0.5, mood: "think" })
      );
      const cheerHtml = renderToString(
        React.createElement(SparkMascot, { skyBrightness: 0.5, mood: "cheer" })
      );
      const oopsHtml = renderToString(
        React.createElement(SparkMascot, { skyBrightness: 0.5, mood: "oops" })
      );
      const sleepyHtml = renderToString(
        React.createElement(SparkMascot, { skyBrightness: 0.5, mood: "sleepy" })
      );

      // Calm has relaxed smile and calm mood class without brow or sparkles
      expect(calmHtml).toContain("spark-mascot-mood-calm");
      expect(calmHtml).not.toContain("spark-mascot-brow");
      expect(calmHtml).not.toContain("spark-mascot-cheer-sparkles");

      // Think has brow and tilted figure
      expect(thinkHtml).toContain("spark-mascot-brow");
      expect(thinkHtml).toContain("spark-mascot-mood-think");

      // Cheer has sparkles around head
      expect(cheerHtml).toContain("spark-mascot-cheer-sparkles");

      // Oops has asymmetric brows and never a frown (mouth has shallow upward curve)
      expect(oopsHtml).toContain("spark-mascot-brow");
      expect(oopsHtml).toContain(SPARK_MOODS.oops.mouth);
      // Ensure oops mouth y-coordinates represent an upward arc, not a downward downturn
      // oops mouth: "M 61 87 C 64 89.5 68 89.5 71 87" -> control points y=89.5 are lower than ends y=87 (smile)
      expect(SPARK_MOODS.oops.mouth).toContain("89.5");

      // Sleepy has drooping eye arcs
      expect(sleepyHtml).toContain(SPARK_MOODS.sleepy.leftEye);
      expect(sleepyHtml).not.toContain("spark-mascot-brow");
    });
  });

  describe("Responsive Sizes & Non-Obstruction", () => {
    it("renders 132px, 84px, and 32px with unified viewBox and pointer-events disabled", () => {
      const sizes: Array<132 | 84 | 32> = [132, 84, 32];

      for (const size of sizes) {
        const html = renderToString(
          React.createElement(SparkMascot, { skyBrightness: 0.8, size })
        );

        expect(html).toContain(`width="${size}"`);
        expect(html).toContain(`height="${size}"`);
        expect(html).toContain('viewBox="0 0 132 132"');
        expect(html).toContain('pointer-events:none');
        expect(html).toContain(`data-size="${size}"`);
      }
    });

    it("compact 32px size retains essential face but omits noisy decorations", () => {
      const compactNovaHtml = renderToString(
        React.createElement(SparkMascot, { skyBrightness: 0.9, size: 32, mood: "cheer" })
      );

      // Essential features remain
      expect(compactNovaHtml).toContain("spark-mascot-face");
      expect(compactNovaHtml).toContain("spark-mascot-body");
      expect(compactNovaHtml).toContain("spark-mascot-crown");

      // Noisy decorations omitted at 32px
      expect(compactNovaHtml).not.toContain("spark-mascot-cheer-sparkles");
      expect(compactNovaHtml).not.toContain("spark-mascot-halo-nova");
    });
  });

  describe("Instance Isolation & Unique ID Resolution", () => {
    it("generates unique gradient and title IDs across multiple rendered instances", () => {
      const tree = React.createElement(
        "div",
        null,
        React.createElement(SparkMascot, { skyBrightness: 0.3, mood: "calm" }),
        React.createElement(SparkMascot, { skyBrightness: 0.3, mood: "calm" }),
        React.createElement(SparkMascot, { skyBrightness: 0.9, mood: "cheer" })
      );

      const html = renderToString(tree);

      const gradMatches = [...html.matchAll(/id="(spark-grad-[^"]+)"/g)].map((m) => m[1]);
      const titleMatches = [...html.matchAll(/id="(spark-title-[^"]+)"/g)].map((m) => m[1]);
      const fillMatches = [...html.matchAll(/fill="url\(#(spark-grad-[^)]+)\)"/g)].map(
        (m) => m[1]
      );
      const ariaMatches = [...html.matchAll(/aria-labelledby="(spark-title-[^"]+)"/g)].map(
        (m) => m[1]
      );

      expect(gradMatches.length).toBe(3);
      expect(titleMatches.length).toBe(3);

      // All 3 IDs are mutually distinct
      const uniqueGrads = new Set(gradMatches);
      const uniqueTitles = new Set(titleMatches);
      expect(uniqueGrads.size).toBe(3);
      expect(uniqueTitles.size).toBe(3);

      // Every fill="url(#id)" points to a gradient defined in the same instance
      for (let i = 0; i < 3; i++) {
        expect(fillMatches[i]).toBe(gradMatches[i]);
        expect(ariaMatches[i]).toBe(titleMatches[i]);
      }
    });
  });
});
