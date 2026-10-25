import type { ClassroomService } from "../../contracts/classroom.js";
import type { ActorContext, UUID } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import type { LectureScriptChunk } from "./cs229-transcript.js";

function validateScript(script: readonly LectureScriptChunk[]): void {
  let prevTimestamp = -1;
  for (const chunk of script) {
    if (!chunk.text || typeof chunk.text !== "string" || chunk.text.trim().length === 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Simulator script chunk text must be non-empty",
      });
    }
    if (
      typeof chunk.timestampSec !== "number" ||
      !Number.isFinite(chunk.timestampSec) ||
      chunk.timestampSec < 0
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Simulator script chunk timestampSec must be a finite non-negative number",
      });
    }
    if (chunk.timestampSec < prevTimestamp) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        statusCode: 400,
        message: "Simulator script chunk timestamps must be non-decreasing",
      });
    }
    prevTimestamp = chunk.timestampSec;

    if (chunk.speakerName !== undefined) {
      if (typeof chunk.speakerName !== "string" || chunk.speakerName.length > 100) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Simulator script chunk speakerName must not exceed 100 characters",
        });
      }
    }
  }
}

export async function runLectureSimulator(
  classroom: Pick<ClassroomService, "ingestTranscriptChunk">,
  actor: ActorContext,
  lectureId: UUID,
  script: readonly LectureScriptChunk[],
  tickRateMs: number,
  signal: AbortSignal,
): Promise<void> {
  validateScript(script);

  if (signal.aborted || script.length === 0) {
    return;
  }

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let currentIndex = 0;
  let inFlight = false;
  let timer: NodeJS.Timeout | null = null;
  let inFlightPromise: Promise<unknown> | null = null;
  let settled = false;

  const cleanup = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const finish = (err?: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (err) {
      reject(err);
    } else {
      resolve();
    }
  };

  const onAbort = async () => {
    cleanup();
    if (inFlightPromise) {
      try {
        await inFlightPromise;
        finish();
      } catch (err: unknown) {
        finish(err);
      }
    } else {
      finish();
    }
  };

  signal.addEventListener("abort", onAbort, { once: true });

  timer = setInterval(async () => {
    if (signal.aborted || settled) {
      cleanup();
      return;
    }

    if (inFlight) {
      // Skip busy tick, retaining next script entry
      return;
    }

    const chunk = script[currentIndex];
    inFlight = true;
    const currentPromise = classroom.ingestTranscriptChunk(
      actor,
      lectureId,
      chunk.text,
      chunk.timestampSec,
      chunk.speakerName,
      { isSimulated: true },
    );
    inFlightPromise = currentPromise;

    try {
      await currentPromise;
      inFlight = false;
      inFlightPromise = null;
      currentIndex++;
      if (currentIndex >= script.length) {
        signal.removeEventListener("abort", onAbort);
        finish();
      }
    } catch (err: unknown) {
      inFlight = false;
      inFlightPromise = null;
      signal.removeEventListener("abort", onAbort);
      finish(err);
    }
  }, tickRateMs);

  timer.unref?.();

  return promise;
}
