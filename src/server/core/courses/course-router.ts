import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { AuthGateway } from "../../platform/index";
import { requireAuth } from "../../platform/index";
import type { CourseService } from "./course-service";
import type { EnrollmentService } from "../enrollment/enrollment-service";
import { uuidSchema } from "../../../contracts/common";
import { AppError } from "../../../contracts/errors";

const createCourseInputSchema = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().optional(),
  })
  .strict();

const enrollInputSchema = z
  .object({
    joinCode: z.string().min(1),
  })
  .strict();

export interface CourseRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  courses: Pick<CourseService, "createCourse" | "getCourse" | "listCourses">;
  enrollment: Pick<EnrollmentService, "enrollStudent">;
}

export function createCourseRouter(dependencies: CourseRouterDependencies): Router {
  const router = Router();

  // GET /api/courses - List courses authorized for caller
  router.get(
    "/api/courses",
    requireAuth(dependencies.auth),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }
        const courses = await dependencies.courses.listCourses(req.actor);
        res.status(200).json(courses);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/courses - Create course (teachers only)
  router.post(
    "/api/courses",
    requireAuth(dependencies.auth),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const parsed = createCourseInputSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid course creation payload",
            cause: parsed.error,
          });
        }

        const course = await dependencies.courses.createCourse(
          req.actor,
          parsed.data.name,
          parsed.data.description
        );
        res.status(201).json(course);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // GET /api/courses/:courseId - Get course by ID
  router.get(
    "/api/courses/:courseId",
    requireAuth(dependencies.auth),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const parsedId = uuidSchema.safeParse(req.params.courseId);
        if (!parsedId.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid course ID format",
          });
        }

        const course = await dependencies.courses.getCourse(req.actor, parsedId.data);
        res.status(200).json(course);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // POST /api/courses/enroll - Enroll student via joinCode
  router.post(
    "/api/courses/enroll",
    requireAuth(dependencies.auth),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.actor) {
          throw new AppError({
            code: "UNAUTHORIZED",
            statusCode: 401,
            message: "Authentication required",
          });
        }

        const parsed = enrollInputSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid enrollment payload",
            cause: parsed.error,
          });
        }

        const student = await dependencies.enrollment.enrollStudent(
          req.actor,
          parsed.data.joinCode
        );

        // Re-verify bearer to refresh ActorContext with the new enrollment
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const freshActor = token ? await dependencies.auth.verifyToken(token) : req.actor;

        const course = await dependencies.courses.getCourse(freshActor, student.courseId);

        res.status(200).json({
          studentId: student.id,
          courseId: student.courseId,
          courseName: course.name,
        });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  return router;
}
