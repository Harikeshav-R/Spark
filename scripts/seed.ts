import "dotenv/config";
import { seedDemoDatabase } from "../src/server/platform/demo/seed-store.js";

async function main(): Promise<void> {
  try {
    const result = await seedDemoDatabase(process.env);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          courseId: result.courseId,
          conceptCount: result.conceptCount,
          edgeCount: result.edgeCount,
          studentCount: result.studentCount,
          masteryCount: result.masteryCount,
          elapsedMs: result.elapsedMs,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify(
        {
          status: "error",
          message,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
}

void main();
