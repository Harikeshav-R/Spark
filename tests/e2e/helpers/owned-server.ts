import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface OwnedServer {
  readonly origin: string;
  readonly port: number;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

export async function startOwnedServer(port = 0): Promise<OwnedServer> {
  const runnerPath = fileURLToPath(new URL("./server-runner.ts", import.meta.url));
  let child: ChildProcess | null = null;
  let activePort = port;
  let activeOrigin = `http://localhost:${port}`;

  const spawnProcess = async (
    targetPort: number
  ): Promise<{ port: number; origin: string }> => {
    const { promise, resolve, reject } = Promise.withResolvers<{
      port: number;
      origin: string;
    }>();

    const childEnv = { ...process.env };
    if (targetPort > 0) {
      childEnv.APP_ORIGIN = `http://localhost:${targetPort}`;
      childEnv.PORT = String(targetPort);
    } else {
      delete childEnv.APP_ORIGIN;
      childEnv.PORT = "3000";
    }
    childEnv.TARGET_PORT = String(targetPort);
    childEnv.NEXT_DIST_DIR = ".next-owned";
    childEnv.NODE_ENV = "development";
    childEnv.INTEGRATION_MODE = "fixture";
    childEnv.LECTURE_SOURCE = "simulator";
    childEnv.DEMO_MODE = "false";

    const proc = fork(runnerPath, [], {
      execArgv: ["--import", "tsx"],
      env: childEnv,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });

    child = proc;

    let stderrOutput = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });
    proc.stdout?.on("data", (chunk: Buffer) => {
      console.log("[owned-server stdout]", chunk.toString().trim());
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        proc.kill("SIGKILL");
        reject(
          new Error(
            `Owned server failed to start within 30000ms on port ${targetPort}`
          )
        );
      }
    }, 30_000);

    proc.on("message", (msg: unknown) => {
      if (
        msg &&
        typeof msg === "object" &&
        "type" in msg &&
        msg.type === "started" &&
        "port" in msg &&
        typeof msg.port === "number" &&
        "origin" in msg &&
        typeof msg.origin === "string"
      ) {
        started = true;
        clearTimeout(timeout);
        resolve({ port: msg.port, origin: msg.origin });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on("exit", (code, signal) => {
      if (!started) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Owned server exited before ready with code ${code}, signal ${signal}: ${stderrOutput}`
          )
        );
      }
    });

    return promise;
  };

  const waitForHealth = async (
    origin: string,
    maxWaitMs = 30_000
  ): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const res = await fetch(`${origin}/api/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
          const body: unknown = await res.json().catch(() => null);
          if (
            body &&
            typeof body === "object" &&
            "status" in body &&
            body.status === "ok"
          ) {
            return;
          }
        }
      } catch {
        // Wait and retry
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(
      `Timed out waiting for owned server health at ${origin}/api/health`
    );
  };

  const initial = await spawnProcess(port);
  activePort = initial.port;
  activeOrigin = initial.origin;
  await waitForHealth(activeOrigin);

  const stop = async (): Promise<void> => {
    if (!child) return;
    const proc = child;
    child = null;

    if (proc.exitCode !== null) {
      return;
    }

    const { promise, resolve } = Promise.withResolvers<void>();
    const exitTimeout = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve();
    }, 5000);

    proc.once("exit", () => {
      clearTimeout(exitTimeout);
      resolve();
    });

    try {
      proc.send({ type: "stop" });
    } catch {
      proc.kill("SIGTERM");
    }
    await promise;
  };

  const restart = async (): Promise<void> => {
    await stop();
    const result = await spawnProcess(activePort);
    activePort = result.port;
    activeOrigin = result.origin;
    await waitForHealth(activeOrigin);
  };

  return {
    get origin() {
      return activeOrigin;
    },
    get port() {
      return activePort;
    },
    stop,
    restart,
  };
}
