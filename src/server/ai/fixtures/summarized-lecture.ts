import type {
  DetectConceptsCandidate,
  LectureTimelineHighlight,
  SummarizedLecture,
} from "../../../contracts/ai.js";
import { fixtureDetectConcepts } from "./detected-concepts.js";

const EMPTY_SUMMARY_NOTICE =
  "## Lecture summary\n\nNo transcript was recorded for this lecture. Key concepts and timestamped excerpts are unavailable.";

const FIXTURE_SUMMARY_HEADER =
  "## Lecture summary\n\nThe following notes preserve the recorded lecture content in chronological order. Review the excerpts alongside the highlighted course concepts.\n\n";

export function fixtureSummarizeLecture(
  chunks: { text: string; timestampSec: number }[],
  candidates: DetectConceptsCandidate[] = []
): SummarizedLecture {
  const retainedChunks = chunks.filter((c) => c.text && c.text.trim().length > 0);
  if (retainedChunks.length === 0) {
    return {
      summary: EMPTY_SUMMARY_NOTICE,
      keyConceptsCovered: [],
      timelineHighlights: [],
    };
  }

  const sortedChunks = [...retainedChunks].sort(
    (a, b) => a.timestampSec - b.timestampSec
  );

  const joinedText = sortedChunks.map((c) => c.text).join(" ");
  const detected = fixtureDetectConcepts(joinedText, candidates);
  const keyConceptsCovered = detected.conceptIds;

  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const matchedLabels = keyConceptsCovered
    .map((id) => candidateMap.get(id)?.label)
    .filter((label): label is string => typeof label === "string" && label.length > 0);

  let summary = FIXTURE_SUMMARY_HEADER;

  if (matchedLabels.length > 0) {
    const conceptLines = matchedLabels.map((l) => `- ${l}`).join("\n");
    const conceptSection = `### Key Concepts\n${conceptLines}\n\n`;
    if (summary.length + conceptSection.length <= 3000) {
      summary += conceptSection;
    }
  }

  let excerptSection = "### Excerpts\n";
  for (const chunk of sortedChunks) {
    const line = `- [${chunk.timestampSec}s] ${chunk.text.trim()}\n`;
    if (summary.length + excerptSection.length + line.length <= 3000) {
      excerptSection += line;
    } else {
      break;
    }
  }
  if (summary.length + excerptSection.length <= 3000) {
    summary += excerptSection;
  }

  summary = summary.trim();

  const highlightChunks = sortedChunks.slice(0, 3);
  const timelineHighlights: LectureTimelineHighlight[] = highlightChunks.map(
    (chunk) => {
      const textExcerpt = chunk.text.slice(0, 240);
      const chunkTextLower = chunk.text.toLowerCase();
      const matchedCandidate = candidates.find(
        (c) =>
          c.label.length > 0 && chunkTextLower.includes(c.label.toLowerCase())
      );
      const conceptLabel = matchedCandidate
        ? matchedCandidate.label
        : "Lecture excerpt";

      return {
        timestampSec: chunk.timestampSec,
        conceptLabel,
        description: textExcerpt,
      };
    }
  );

  return {
    summary,
    keyConceptsCovered,
    timelineHighlights,
  };
}
