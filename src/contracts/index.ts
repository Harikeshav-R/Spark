export type UUID = string;
export type ISOTimestamp = string;

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
