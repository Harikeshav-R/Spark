import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CryptoIdGenerator } from "../../../src/server/core/id-generator";
import type { ActorContext, UUID } from "../../../src/contracts";

const idGenerator = new CryptoIdGenerator();

export interface TestUser {
  authId: UUID;
  email: string;
  name: string;
  role: "student" | "teacher";
}

export interface TestCourseContext {
  courseId: UUID;
  teacherId: UUID;
  teacherAuthId: UUID;
  joinCode: string;
  conceptIds: UUID[];
}

export interface TestContext {
  users: TestUser[];
  teacherIds: UUID[];
  courseIds: UUID[];
}

export function getLocalSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`Refusing non-loopback SUPABASE_URL: ${url}`);
  }
  return url;
}

export function getLocalServiceRoleKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
  );
}

export function getLocalAnonKey(): string {
  return (
    process.env.SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A-399crEuCHPBc_iWvxl_m_Bv_h8p_89P75_w"
  );
}

export function createServiceClient(): SupabaseClient {
  return createClient(getLocalSupabaseUrl(), getLocalServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient(): SupabaseClient {
  return createClient(getLocalSupabaseUrl(), getLocalAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseTestHarness {
  readonly serviceClient: SupabaseClient;
  readonly anonClient: SupabaseClient;

  constructor() {
    this.serviceClient = createServiceClient();
    this.anonClient = createAnonClient();
  }

  async createTestUser(
    context: TestContext,
    role: "student" | "teacher",
    options?: { name?: string; email?: string },
  ): Promise<TestUser> {
    const uniqueSuffix = randomUUID().slice(0, 8);
    const email = options?.email || `test-${role}-${uniqueSuffix}@example.com`;
    const name = options?.name || (role === "teacher" ? `Prof ${uniqueSuffix}` : `Student ${uniqueSuffix}`);

    const { data, error } = await this.serviceClient.auth.admin.createUser({
      email,
      password: "TestPassword123!",
      email_confirm: true,
      user_metadata: { role, name },
    });

    if (error || !data.user) {
      throw new Error(`Failed to create test auth user: ${error?.message}`);
    }

    const testUser: TestUser = {
      authId: data.user.id,
      email,
      name,
      role,
    };
    context.users.push(testUser);
    return testUser;
  }

  async createTestCourse(
    context: TestContext,
    options?: { conceptCount?: number; joinCode?: string },
  ): Promise<TestCourseContext> {
    const teacherUser = await this.createTestUser(context, "teacher");

    const teacherId = randomUUID();
    const { error: teacherError } = await this.serviceClient.from("teachers").insert({
      id: teacherId,
      auth_id: teacherUser.authId,
      name: teacherUser.name,
      email: teacherUser.email,
    });
    if (teacherError) {
      throw new Error(`Failed to insert test teacher: ${teacherError.message}`);
    }
    context.teacherIds.push(teacherId);

    const courseId = randomUUID();
    const joinCode = options?.joinCode || idGenerator.generateJoinCode();
    const { error: courseError } = await this.serviceClient.from("courses").insert({
      id: courseId,
      teacher_id: teacherId,
      name: `Test Course ${joinCode}`,
      description: "Integration test course",
      join_code: joinCode,
    });
    if (courseError) {
      throw new Error(`Failed to insert test course: ${courseError.message}`);
    }
    context.courseIds.push(courseId);

    const conceptCount = options?.conceptCount ?? 33;
    const conceptIds: UUID[] = [];

    if (conceptCount > 0) {
      const conceptRows = Array.from({ length: conceptCount }, (_, i) => {
        const id = randomUUID();
        conceptIds.push(id);
        const indexStr = String(i + 1).padStart(2, "0");
        return {
          id,
          course_id: courseId,
          label: `Concept ${indexStr}`,
          description: "",
          category: "verification",
          difficulty: 3,
        };
      });

      const { error: conceptsError } = await this.serviceClient.from("concept_nodes").insert(conceptRows);
      if (conceptsError) {
        throw new Error(`Failed to insert test concept nodes: ${conceptsError.message}`);
      }
    }

    return {
      courseId,
      teacherId,
      teacherAuthId: teacherUser.authId,
      joinCode,
      conceptIds,
    };
  }

  buildStudentActor(
    user: TestUser,
    enrolledCourses: { studentId: UUID; courseId: UUID }[] = [],
  ): ActorContext {
    return {
      userId: user.authId,
      authId: user.authId,
      email: user.email,
      name: user.name,
      role: "student",
      enrolledCourses,
    };
  }

  buildTeacherActor(
    user: TestUser,
    teacherId: UUID,
    enrolledCourses: { studentId: UUID; courseId: UUID }[] = [],
  ): ActorContext {
    return {
      userId: user.authId,
      authId: user.authId,
      email: user.email,
      name: user.name,
      role: "teacher",
      teacherId,
      enrolledCourses,
    };
  }

  async cleanup(context: TestContext): Promise<void> {
    const errors: unknown[] = [];

    for (const courseId of context.courseIds) {
      try {
        await this.serviceClient.from("courses").delete().eq("id", courseId);
      } catch (err) {
        errors.push(err);
      }
    }

    for (const teacherId of context.teacherIds) {
      try {
        await this.serviceClient.from("teachers").delete().eq("id", teacherId);
      } catch (err) {
        errors.push(err);
      }
    }

    for (const user of context.users) {
      try {
        await this.serviceClient.auth.admin.deleteUser(user.authId);
      } catch (err) {
        errors.push(err);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Cleanup failed with ${errors.length} error(s): ${JSON.stringify(errors)}`);
    }
  }
}
