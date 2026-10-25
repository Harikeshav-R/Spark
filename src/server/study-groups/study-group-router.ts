import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { AuthGateway } from "../platform/index.js";
import { requireAuth } from "../platform/index.js";
import { uuidSchema, isoTimestampSchema } from "../../contracts/common.js";
import { AppError } from "../../contracts/errors.js";
import type { StudyGroupService } from "./study-group-service.js";
import type { MessagingService } from "./messaging-service.js";
import type { MessagingRepository } from "./messaging-repository.js";
import type { Scheduler } from "./scheduler.js";
import type { SchedulerRepository } from "./scheduler-repository.js";
import type { AvailabilityService } from "./availability-service.js";

const putAvailabilityBodySchema = z
  .object({
    intervals: z.array(
      z
        .object({
          startsAt: isoTimestampSchema,
          endsAt: isoTimestampSchema,
        })
        .strict()
    ),
  })
  .strict();

const optInBodySchema = z
  .object({
    conceptIds: z.array(uuidSchema).min(1).max(3),
  })
  .strict();

const postMessageBodySchema = z
  .object({
    content: z.string().trim().min(1).max(2000),
  })
  .strict();

const acceptScheduleBodySchema = z
  .object({
    startsAt: isoTimestampSchema,
    endsAt: isoTimestampSchema,
  })
  .strict();

export interface StudyGroupRouterDependencies {
  auth: Pick<AuthGateway, "verifyToken">;
  studyGroups: Pick<StudyGroupService, "optIntoPool" | "optOutOfPool">;
  messaging: Pick<MessagingService, "getMatchMessages" | "sendMessage">;
  membership: Pick<MessagingRepository, "requireMatchMember">;
  scheduler: Pick<Scheduler, "proposeSchedule" | "acceptSchedule">;
  schedulerRepository: Pick<SchedulerRepository, "getMatch">;
  availability: Pick<AvailabilityService, "registerAvailability" | "getAvailability">;
}

export function createStudyGroupRouter(
  dependencies: StudyGroupRouterDependencies
): Router {
  const router = Router();
  const authMiddleware = requireAuth(dependencies.auth);

  // 1. GET /api/courses/:courseId/study-groups/availability
  router.get(
    "/api/courses/:courseId/study-groups/availability",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const courseId = uuidSchema.parse(req.params.courseId);
        const intervals = await dependencies.availability.getAvailability(
          actor,
          courseId
        );
        res.status(200).json(intervals);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 2. PUT /api/courses/:courseId/study-groups/availability
  router.put(
    "/api/courses/:courseId/study-groups/availability",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const courseId = uuidSchema.parse(req.params.courseId);

        const parsedBody = putAvailabilityBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid availability intervals payload",
            cause: parsedBody.error,
          });
        }

        await dependencies.availability.registerAvailability(
          actor,
          courseId,
          parsedBody.data.intervals
        );

        const reread = await dependencies.availability.getAvailability(
          actor,
          courseId
        );
        res.status(200).json(reread);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 3. POST /api/courses/:courseId/study-groups/opt-in
  router.post(
    "/api/courses/:courseId/study-groups/opt-in",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const courseId = uuidSchema.parse(req.params.courseId);

        const parsedBody = optInBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid opt-in payload: conceptIds must have 1 to 3 items",
            cause: parsedBody.error,
          });
        }

        const result = await dependencies.studyGroups.optIntoPool(
          actor,
          courseId,
          parsedBody.data.conceptIds
        );
        res.status(200).json(result);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 4. POST /api/courses/:courseId/study-groups/opt-out
  router.post(
    "/api/courses/:courseId/study-groups/opt-out",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const courseId = uuidSchema.parse(req.params.courseId);

        await dependencies.studyGroups.optOutOfPool(actor, courseId);
        res.status(200).json({ success: true });
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 5. GET /api/study-groups/:matchId/messages
  router.get(
    "/api/study-groups/:matchId/messages",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const matchId = uuidSchema.parse(req.params.matchId);

        const messages = await dependencies.messaging.getMatchMessages(
          actor,
          matchId
        );
        res.status(200).json(messages);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 6. POST /api/study-groups/:matchId/messages
  router.post(
    "/api/study-groups/:matchId/messages",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const matchId = uuidSchema.parse(req.params.matchId);

        const parsedBody = postMessageBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid message payload: content must be non-empty",
            cause: parsedBody.error,
          });
        }

        const message = await dependencies.messaging.sendMessage(
          actor,
          matchId,
          parsedBody.data.content
        );
        res.status(201).json(message);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 7. POST /api/study-groups/:matchId/schedule
  router.post(
    "/api/study-groups/:matchId/schedule",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const matchId = uuidSchema.parse(req.params.matchId);

        const result = await dependencies.scheduler.proposeSchedule(
          actor,
          matchId
        );
        res.status(200).json(result);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  // 8. POST /api/study-groups/:matchId/schedule/accept
  router.post(
    "/api/study-groups/:matchId/schedule/accept",
    authMiddleware,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const actor = req.actor!;
        const matchId = uuidSchema.parse(req.params.matchId);

        const parsedBody = acceptScheduleBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new AppError({
            code: "VALIDATION_ERROR",
            statusCode: 400,
            message: "Invalid schedule accept payload",
            cause: parsedBody.error,
          });
        }

        await dependencies.scheduler.acceptSchedule(
          actor,
          matchId,
          parsedBody.data
        );

        const member = await dependencies.membership.requireMatchMember(
          actor,
          matchId
        );
        const match = await dependencies.schedulerRepository.getMatch(
          member.courseId,
          matchId
        );

        if (!match) {
          throw new AppError({
            code: "NOT_FOUND",
            statusCode: 404,
            message: "Study group match not found",
          });
        }

        const responsePayload: {
          schedulingStatus: string;
          bothAccepted: boolean;
          zoomMeeting?: { meetingId: string; joinUrl: string };
        } = {
          schedulingStatus: match.schedulingStatus,
          bothAccepted: match.student1Accepted && match.student2Accepted,
        };

        if (match.zoomMeetingId && match.zoomLink) {
          responsePayload.zoomMeeting = {
            meetingId: match.zoomMeetingId,
            joinUrl: match.zoomLink,
          };
        }

        res.status(200).json(responsePayload);
      } catch (err: unknown) {
        next(err);
      }
    }
  );

  return router;
}
