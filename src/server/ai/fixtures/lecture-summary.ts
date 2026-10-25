import type {
  DetectConceptsCandidate,
  LectureTimelineHighlight,
  SummarizedLecture,
} from "../../../contracts/ai.js";
import type { UUID } from "../../../contracts/common.js";

export const FIXTURE_SUMMARY_CONCEPT_ID_1: UUID = "33333333-3333-4333-8333-333333333316";
export const FIXTURE_SUMMARY_CONCEPT_ID_2: UUID = "33333333-3333-4333-8333-333333333317";

export const ZERO_CHUNKS_SUMMARY_TEXT =
  "No transcript chunks were recorded for this lecture session. Please ensure microphone audio and speech transcription are connected during the presentation.";

export function fixtureSummarizeLecture(
  transcriptChunks: { text: string; timestampSec: number }[],
  candidateConcepts?: DetectConceptsCandidate[]
): SummarizedLecture {
  if (!transcriptChunks || transcriptChunks.length === 0) {
    return {
      summary: ZERO_CHUNKS_SUMMARY_TEXT,
      keyConceptsCovered: [],
      timelineHighlights: [],
    };
  }

  const combinedText = transcriptChunks.map((c) => c.text).join(" ");
  const textLower = combinedText.toLowerCase();

  const matchedConceptIds: UUID[] = [];
  const timelineHighlights: LectureTimelineHighlight[] = [];
  const seenConcepts = new Set<string>();

  if (candidateConcepts && candidateConcepts.length > 0) {
    for (const candidate of candidateConcepts) {
      if (
        candidate.label.length > 0 &&
        textLower.includes(candidate.label.toLowerCase())
      ) {
        if (!seenConcepts.has(candidate.id)) {
          seenConcepts.add(candidate.id);
          matchedConceptIds.push(candidate.id);

          // Find first chunk matching this candidate
          const matchingChunk = transcriptChunks.find((c) =>
            c.text.toLowerCase().includes(candidate.label.toLowerCase())
          );
          if (matchingChunk) {
            timelineHighlights.push({
              timestampSec: matchingChunk.timestampSec,
              conceptLabel: candidate.label,
              description: `Discussion of ${candidate.label} and related theoretical foundations.`,
            });
          }
        }
      }
    }
  }

  // If no candidates matched or none supplied, fall back to canonical gradient descent fixture
  if (matchedConceptIds.length === 0) {
    matchedConceptIds.push(FIXTURE_SUMMARY_CONCEPT_ID_1, FIXTURE_SUMMARY_CONCEPT_ID_2);
  }

  if (timelineHighlights.length === 0) {
    const firstTimestamp = transcriptChunks[0]?.timestampSec ?? 0;
    const midTimestamp =
      transcriptChunks[Math.floor(transcriptChunks.length / 2)]?.timestampSec ??
      firstTimestamp + 120;

    timelineHighlights.push(
      {
        timestampSec: firstTimestamp,
        conceptLabel: "Gradient Descent",
        description: "Introduction to loss function surfaces and negative gradient direction.",
      },
      {
        timestampSec: midTimestamp,
        conceptLabel: "Learning Rate",
        description: "Analysis of step sizes, oscillation boundaries, and divergence criteria.",
      }
    );
  }

  // Sort timeline highlights chronologically
  timelineHighlights.sort((a, b) => a.timestampSec - b.timestampSec);

  const summaryMarkdown = [
    "## Lecture Overview",
    "In this lecture, we explored gradient descent optimization algorithms, analyzed the impact of learning rate schedules on convergence, and derived backpropagation updates across deep neural network computational graphs.",
    "",
    "## Key Concepts Covered",
    "- **Loss Functions & Objective Surfaces**: Quantifying prediction error across multi-dimensional parameter spaces.",
    "- **Gradient Descent**: Moving model weights iteratively in the steepest downhill direction.",
    "- **Learning Rate Tuning**: Balancing fast convergence against oscillation or divergence.",
    "",
    "## Summary & Takeaways",
    "Students investigated gradient dynamics under varying learning rates, observing how excessive step sizes lead to numerical overflow while conservative step sizes stall progress on shallow plateaus.",
  ].join("\n");

  return {
    summary: summaryMarkdown,
    keyConceptsCovered: matchedConceptIds,
    timelineHighlights,
  };
}
