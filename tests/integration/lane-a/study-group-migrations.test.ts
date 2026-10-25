import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runPsql, runPsqlExpectError } from "./postgres-test-helpers";

const isFixtureMode = process.env.INTEGRATION_MODE === "fixture";

describe.skipIf(isFixtureMode)("study-group migrations incremental verification", () => {
  it(
    "applies chronological migrations 0001->0005, verifies data preservation, availability, messages, and foreign key transitions",
    () => {
      // 1. Verify required cluster roles exist
      const rolesOutput = runPsql(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') ORDER BY rolname;"
      );
      const roles = rolesOutput
        .trim()
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean);

      for (const requiredRole of ["anon", "authenticated", "service_role"]) {
        if (!roles.includes(requiredRole)) {
          throw new Error(
            `Required cluster role "${requiredRole}" is missing. Found: ${roles.join(", ")}`
          );
        }
      }

      // 2. Generate isolated test database name strictly conforming to pattern
      const rawHex = randomUUID().replace(/-/g, "").toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(rawHex)) {
        throw new Error("Invalid UUID hex for migration test database name");
      }
      const dbName = `spark_p6_migration_${rawHex}`;

      // Create isolated database from template0
      runPsql(`CREATE DATABASE ${dbName} TEMPLATE template0;`);

      let testError: unknown;
      let cleanupError: unknown;

      try {
        // Bootstrap minimal auth dependency fixture
        runPsql(
          "CREATE SCHEMA auth; CREATE TABLE auth.users (id UUID PRIMARY KEY);",
          dbName
        );

        // Helper to load migration SQL from repository
        const loadMigration = (filename: string): string =>
          readFileSync(
            resolve(process.cwd(), "supabase/migrations", filename),
            "utf8"
          );

        // Apply migrations in chronological order
        // 1. 20261020000001_initial_schema.sql
        runPsql(loadMigration("20261020000001_initial_schema.sql"), dbName);

        // 2. 20261020000002_mastery_rpc.sql
        runPsql(loadMigration("20261020000002_mastery_rpc.sql"), dbName);

        // 3. 20261021000001_enrollment_rpc.sql
        runPsql(loadMigration("20261021000001_enrollment_rpc.sql"), dbName);

        // 4. 20261021000003_spark_learning.sql
        runPsql(loadMigration("20261021000003_spark_learning.sql"), dbName);

        // Before 0004: Seed auth identities, teacher, course, students, concepts, pool entries, match, and encounter
        const teacherAuthId = randomUUID();
        const student1AuthId = randomUUID();
        const student2AuthId = randomUUID();
        runPsql(
          `INSERT INTO auth.users (id) VALUES ('${teacherAuthId}'), ('${student1AuthId}'), ('${student2AuthId}');`,
          dbName
        );

        const teacherId = randomUUID();
        runPsql(
          `INSERT INTO teachers (id, auth_id, name, email) VALUES ('${teacherId}', '${teacherAuthId}', 'Teacher One', 'teacher1@test.edu');`,
          dbName
        );

        const courseId = randomUUID();
        runPsql(
          `INSERT INTO courses (id, teacher_id, name, join_code) VALUES ('${courseId}', '${teacherId}', 'Test Course', 'MIGR1234');`,
          dbName
        );

        // Two canonically ordered students: student1Id < student2Id
        const u1 = randomUUID();
        let u2 = randomUUID();
        while (u1 === u2) {
          u2 = randomUUID();
        }
        const student1Id = u1 < u2 ? u1 : u2;
        const student2Id = u1 < u2 ? u2 : u1;

        runPsql(
          `INSERT INTO students (id, auth_id, course_id, name, email) VALUES ` +
            `('${student1Id}', '${student1AuthId}', '${courseId}', 'Student One', 's1@test.edu'), ` +
            `('${student2Id}', '${student2AuthId}', '${courseId}', 'Student Two', 's2@test.edu');`,
          dbName
        );

        const concept1Id = randomUUID();
        const concept2Id = randomUUID();
        const concept3Id = randomUUID();
        runPsql(
          `INSERT INTO concept_nodes (id, course_id, label, description, category) VALUES ` +
            `('${concept1Id}', '${courseId}', 'Concept A', 'Description A', 'Category A'), ` +
            `('${concept2Id}', '${courseId}', 'Concept B', 'Description B', 'Category A'), ` +
            `('${concept3Id}', '${courseId}', 'Concept C', 'Description C', 'Category A');`,
          dbName
        );

        const pool1Id = randomUUID();
        const pool2Id = randomUUID();
        runPsql(
          `INSERT INTO study_group_pool (id, student_id, course_id, concept_ids, status) VALUES ` +
            `('${pool1Id}', '${student1Id}', '${courseId}', ARRAY['${concept1Id}', '${concept2Id}']::uuid[], 'waiting'), ` +
            `('${pool2Id}', '${student2Id}', '${courseId}', ARRAY['${concept1Id}', '${concept3Id}']::uuid[], 'waiting');`,
          dbName
        );

        const matchId = randomUUID();
        runPsql(
          `INSERT INTO study_group_matches (id, course_id, student1_id, student2_id, concept_ids, status) VALUES ` +
            `('${matchId}', '${courseId}', '${student1Id}', '${student2Id}', ARRAY['${concept1Id}']::uuid[], 'active');`,
          dbName
        );

        // Capture exact fixture rows and values before 0004
        const baselinePool1 = runPsql(
          `SELECT student_id, course_id, status FROM study_group_pool WHERE id = '${pool1Id}';`,
          dbName
        ).trim();
        const baselinePool2 = runPsql(
          `SELECT student_id, course_id, status FROM study_group_pool WHERE id = '${pool2Id}';`,
          dbName
        ).trim();
        const baselineMatch = runPsql(
          `SELECT course_id, student1_id, student2_id, status FROM study_group_matches WHERE id = '${matchId}';`,
          dbName
        ).trim();

        expect(baselinePool1).toBe(`${student1Id}|${courseId}|waiting`);
        expect(baselinePool2).toBe(`${student2Id}|${courseId}|waiting`);
        expect(baselineMatch).toBe(`${courseId}|${student1Id}|${student2Id}|active`);

        // Insert a party-source encounter with an orphan party UUID and confirm it persists under 0003
        const encounterId = randomUUID();
        const orphanPartyId = randomUUID();
        runPsql(
          `INSERT INTO encounters (id, student_id, concept_id, source, party_quest_id, status, question_ids, option_permutations) ` +
            `VALUES ('${encounterId}', '${student1Id}', '${concept1Id}', 'party', '${orphanPartyId}', 'active', ARRAY['${randomUUID()}']::uuid[], '{}'::jsonb);`,
          dbName
        );

        const orphanRead = runPsql(
          `SELECT party_quest_id FROM encounters WHERE id = '${encounterId}';`,
          dbName
        ).trim();
        expect(orphanRead).toBe(orphanPartyId);

        // Clear orphan party_quest_id before applying 0005 so FK can be created cleanly
        runPsql(
          `UPDATE encounters SET party_quest_id = NULL WHERE id = '${encounterId}';`,
          dbName
        );

        // 5. Apply 20261022000004_study_groups.sql
        runPsql(loadMigration("20261022000004_study_groups.sql"), dbName);

        // After 0004: verify seeded pool/match rows remain unchanged
        const post0004Pool1 = runPsql(
          `SELECT student_id, course_id, status FROM study_group_pool WHERE id = '${pool1Id}';`,
          dbName
        ).trim();
        const post0004Pool2 = runPsql(
          `SELECT student_id, course_id, status FROM study_group_pool WHERE id = '${pool2Id}';`,
          dbName
        ).trim();
        const post0004Match = runPsql(
          `SELECT course_id, student1_id, student2_id, status FROM study_group_matches WHERE id = '${matchId}';`,
          dbName
        ).trim();

        expect(post0004Pool1).toBe(baselinePool1);
        expect(post0004Pool2).toBe(baselinePool2);
        expect(post0004Match).toBe(baselineMatch);

        // Insert and read a valid 30-minute availability interval
        const availId = randomUUID();
        runPsql(
          `INSERT INTO student_availability (id, student_id, course_id, starts_at, ends_at) ` +
            `VALUES ('${availId}', '${student1Id}', '${courseId}', NOW(), NOW() + INTERVAL '30 minutes');`,
          dbName
        );
        const readAvail = runPsql(
          `SELECT id, student_id, course_id FROM student_availability WHERE id = '${availId}';`,
          dbName
        ).trim();
        expect(readAvail).toBe(`${availId}|${student1Id}|${courseId}`);

        // Insert and read a message attached to the preserved match
        const msgId = randomUUID();
        runPsql(
          `INSERT INTO study_group_messages (id, match_id, sender_id, content) ` +
            `VALUES ('${msgId}', '${matchId}', '${student1Id}', 'Let us study Concept A');`,
          dbName
        );
        const readMsg = runPsql(
          `SELECT match_id, sender_id, content FROM study_group_messages WHERE id = '${msgId}';`,
          dbName
        ).trim();
        expect(readMsg).toBe(`${matchId}|${student1Id}|Let us study Concept A`);

        // 6. Apply 20261022000005_spark_collaboration.sql
        runPsql(loadMigration("20261022000005_spark_collaboration.sql"), dbName);

        // After 0005: verify baseline rows, availability, and message still persist
        const post0005Pool1 = runPsql(
          `SELECT student_id, course_id, status FROM study_group_pool WHERE id = '${pool1Id}';`,
          dbName
        ).trim();
        const post0005Match = runPsql(
          `SELECT course_id, student1_id, student2_id, status FROM study_group_matches WHERE id = '${matchId}';`,
          dbName
        ).trim();
        const post0005Avail = runPsql(
          `SELECT id FROM student_availability WHERE id = '${availId}';`,
          dbName
        ).trim();
        const post0005Msg = runPsql(
          `SELECT content FROM study_group_messages WHERE id = '${msgId}';`,
          dbName
        ).trim();

        expect(post0005Pool1).toBe(baselinePool1);
        expect(post0005Match).toBe(baselineMatch);
        expect(post0005Avail).toBe(availId);
        expect(post0005Msg).toBe("Let us study Concept A");

        // Create a real party quest for the preserved match and link the encounter to it
        const questId = randomUUID();
        runPsql(
          `INSERT INTO party_quests (id, match_id, concept_ids, status) ` +
            `VALUES ('${questId}', '${matchId}', ARRAY['${concept1Id}']::uuid[], 'active');`,
          dbName
        );
        runPsql(
          `UPDATE encounters SET party_quest_id = '${questId}' WHERE id = '${encounterId}';`,
          dbName
        );
        const linkedQuest = runPsql(
          `SELECT party_quest_id FROM encounters WHERE id = '${encounterId}';`,
          dbName
        ).trim();
        expect(linkedQuest).toBe(questId);

        // Attempt to set encounter's party_quest_id to a nonexistent UUID: expect 23503 foreign key violation
        const fakeQuestId = randomUUID();
        const fkError = runPsqlExpectError(
          `UPDATE encounters SET party_quest_id = '${fakeQuestId}' WHERE id = '${encounterId}';`,
          dbName
        );
        expect(fkError.code).toBe("23503");

        // Verify valid association remains unchanged after rejected update
        const unchangedLinkedQuest = runPsql(
          `SELECT party_quest_id FROM encounters WHERE id = '${encounterId}';`,
          dbName
        ).trim();
        expect(unchangedLinkedQuest).toBe(questId);

        // Delete the real party quest: expect encounter retained and its party_quest_id set to NULL
        runPsql(`DELETE FROM party_quests WHERE id = '${questId}';`, dbName);
        const encounterAfterDelete = runPsql(
          `SELECT id, party_quest_id FROM encounters WHERE id = '${encounterId}';`,
          dbName
        ).trim();
        expect(encounterAfterDelete).toBe(`${encounterId}|`);
      } catch (err: unknown) {
        testError = err;
      } finally {
        try {
          runPsql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`);
        } catch (err: unknown) {
          cleanupError = err;
        }
      }

      if (testError && cleanupError) {
        throw new AggregateError(
          [testError, cleanupError],
          `Migration test scenario failed and cleanup of database ${dbName} also failed`
        );
      }
      if (testError) {
        throw testError;
      }
      if (cleanupError) {
        throw cleanupError;
      }
    },
    60000
  );
});
