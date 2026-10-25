import { execFileSync } from "node:child_process";

export const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? (
  (() => {
    try {
      execFileSync("docker", ["inspect", "supabase_db_spark"], { stdio: "ignore" });
      return "supabase_db_spark";
    } catch {
      return "supabase_db_HackOHIO-2026";
    }
  })()
);

export function runPsql(sql: string, database = "postgres"): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      sql,
    ],
    { encoding: "utf8" }
  );
}

export function runPsqlExpectError(
  sql: string,
  database = "postgres"
): { code: string; message: string; stderr: string } {
  let failed = false;
  let caughtError: unknown;

  try {
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        DB_CONTAINER,
        "psql",
        "-U",
        "postgres",
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
        "-c",
        sql,
      ],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err: unknown) {
    failed = true;
    caughtError = err;
  }

  if (!failed) {
    throw new Error("Expected psql command to fail but it succeeded");
  }

  const stderr =
    caughtError && typeof caughtError === "object" && "stderr" in caughtError && caughtError.stderr
      ? String(caughtError.stderr)
      : String(caughtError);

  const codeMatch = stderr.match(/ERROR:\s+([0-9A-Z]{5}):/i) ?? stderr.match(/SQLSTATE:\s+([0-9A-Z]{5})/i);
  const code = codeMatch ? codeMatch[1] : "";
  return { code, message: stderr, stderr };
}
