import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import type { AuthGateway } from "../../platform/index";
import { requireAuth } from "../../platform/index";
import type { CourseService } from "../courses/course-service";
import type { SyllabusIngestionService } from "./syllabus-ingestion-service";
import { uuidSchema, type UUID } from "../../../contracts/common";
import { syllabusUploadPreviewResponseSchema } from "../../../contracts/course";
import { AppError } from "../../../contracts/errors";

export interface SyllabusRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  courses: Pick<CourseService, "getCourse">;
  syllabusIngestion: Pick<SyllabusIngestionService, "processSyllabusUpload">;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      cb(
        new AppError({
          code: "VALIDATION_ERROR",
          statusCode: 400,
          message: "Only PDF files are supported for syllabus upload",
        })
      );
      return;
    }
    cb(null, true);
  },
});

export function createSyllabusRouter(dependencies: SyllabusRouterDependencies): Router {
  const router = Router();

  // POST /api/courses/:courseId/upload (and /syllabus/upload alias)
  router.post(
    ["/api/courses/:courseId/upload", "/api/courses/:courseId/syllabus/upload"],
    requireAuth(dependencies.auth),
    // Step 1: Pre-buffer authorization check
    async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor;
        if (!actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const rawCourseId = req.params["courseId"];
        const parsedId = uuidSchema.safeParse(rawCourseId);
        if (!parsedId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid course ID format",
          });
        }

        // Authorize course owner before buffering file upload
        const course = await dependencies.courses.getCourse(actor, parsedId.data);
        if (actor.role !== "teacher" || course.teacherId !== actor.teacherId) {
          throw new AppError({
            code: "FORBIDDEN",
            statusCode: 403,
            message: "Only the owning instructor can upload a course syllabus",
          });
        }

        next();
      } catch (err: unknown) {
        next(err);
      }
    },
    // Step 2: Multer streaming and buffering with size bounds
    (req: Request, res: Response, next: NextFunction): void => {
      upload.single("syllabus")(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return next(
              new AppError({
                code: "PAYLOAD_TOO_LARGE",
                statusCode: 413,
                message: "Syllabus PDF exceeds 50 MiB size limit",
              })
            );
          }
          return next(
            new AppError({
              code: "VALIDATION_ERROR",
              statusCode: 400,
              message: `Multipart upload error: ${err.message}`,
              cause: err,
            })
          );
        }
        if (err) {
          return next(err);
        }
        if (!req.file) {
          return next(
            new AppError({
              code: "VALIDATION_ERROR",
              statusCode: 400,
              message: "Missing syllabus file under field 'syllabus'",
            })
          );
        }
        next();
      });
    },
    // Step 3: Ingestion service processing and response projection
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const courseId = req.params["courseId"] as UUID;
        const file = req.file!;

        const extraction = await dependencies.syllabusIngestion.processSyllabusUpload(
          actor,
          courseId,
          file.buffer,
          file.originalname
        );

        const responsePayload = syllabusUploadPreviewResponseSchema.parse({
          courseId,
          totalPages: extraction.totalPages,
          processedPages: extraction.processedPages,
          truncated: extraction.truncated,
          preview: {
            concepts: extraction.concepts,
            edges: extraction.edges,
          },
        });
        res.status(200).json(responsePayload);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  return router;
}
