import { z } from "zod";

export type UUID = string;
export type ISOTimestamp = string; // UTC ISO-8601 (e.g., "2026-10-20T14:30:00.000Z")

export type UserRole = "teacher" | "student";

export type MasteryBand = "gray" | "red" | "yellow" | "green";

export interface ActorContext {
  userId: UUID;
  authId: UUID;
  email: string;
  name: string;
  role: UserRole;
  teacherId?: UUID;
  enrolledCourses: {
    studentId: UUID;
    courseId: UUID;
  }[];
}

export interface Clock {
  now(): Date;
  nowISO(): ISOTimestamp;
}

export interface IdGenerator {
  generateId(): UUID;
  generateJoinCode(): string;
}

export interface AuthUser {
  id: UUID;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  user: AuthUser;
  session: AuthSession;
}

export interface PaginatedList<T> {
  items: T[];
  nextCursor?: string | null;
}

export const uuidSchema = z.uuid();
export const isoTimestampSchema = z.iso.datetime();
export const userRoleSchema = z.enum(["teacher", "student"]);
export const masteryBandSchema = z.enum(["gray", "red", "yellow", "green"]);

export const enrolledCourseSchema = z.object({
  studentId: uuidSchema,
  courseId: uuidSchema,
});

export const actorContextSchema = z.object({
  userId: uuidSchema,
  authId: uuidSchema,
  email: z.email(),
  name: z.string().min(1),
  role: userRoleSchema,
  teacherId: uuidSchema.optional(),
  enrolledCourses: z.array(enrolledCourseSchema),
});

export const authUserSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  name: z.string().min(1),
  role: userRoleSchema,
});

export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

export const loginResponseSchema = z.object({
  user: authUserSchema,
  session: authSessionSchema,
});

export function paginatedListSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable().optional(),
  });
}
