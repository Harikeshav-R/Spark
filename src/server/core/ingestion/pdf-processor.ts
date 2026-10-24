import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { AppError, DomainErrorCode } from "../../../contracts/errors";

export const MAX_SYLLABUS_BYTES = 50 * 1024 * 1024;
export const MAX_SYLLABUS_PAGES = 10;

export interface ProcessedSyllabusPdf {
  totalPages: number;
  processedPages: number;
  truncated: boolean;
  pdfBytes: Buffer;
}

export function assertSyllabusSize(pdfBytes: Buffer): void {
  if (!pdfBytes || pdfBytes.length === 0) {
    throw new AppError({
      code: DomainErrorCode.BAD_REQUEST,
      statusCode: 400,
      message: "Syllabus PDF is empty",
    });
  }

  if (pdfBytes.length > MAX_SYLLABUS_BYTES) {
    throw new AppError({
      code: DomainErrorCode.PAYLOAD_TOO_LARGE,
      statusCode: 413,
      message: "Syllabus PDF exceeds 50 MiB limit",
    });
  }
}

export function hashSyllabusPdf(pdfBytes: Buffer): string {
  assertSyllabusSize(pdfBytes);
  return createHash("sha256").update(pdfBytes).digest("hex");
}

export async function processSyllabusPdf(
  pdfBytes: Buffer,
): Promise<ProcessedSyllabusPdf> {
  assertSyllabusSize(pdfBytes);

  try {
    const doc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
    });

    if (doc.isEncrypted) {
      throw new Error("Syllabus PDF is encrypted");
    }

    const totalPages = doc.getPageCount();
    if (totalPages === 0) {
      throw new Error("Syllabus PDF contains no pages");
    }

    const processedPages = Math.min(totalPages, MAX_SYLLABUS_PAGES);
    const truncated = totalPages > MAX_SYLLABUS_PAGES;

    const boundedDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: processedPages }, (_, i) => i);
    const copiedPages = await boundedDoc.copyPages(doc, pageIndices);

    for (const page of copiedPages) {
      boundedDoc.addPage(page);
    }

    const savedBytes = await boundedDoc.save();
    return {
      totalPages,
      processedPages,
      truncated,
      pdfBytes: Buffer.from(savedBytes),
    };
  } catch (err: unknown) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError({
      code: DomainErrorCode.BAD_REQUEST,
      statusCode: 400,
      message: "Invalid or unsupported syllabus PDF",
      cause: err,
    });
  }
}
