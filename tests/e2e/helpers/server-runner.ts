import { startServer } from "../../../server/index.js";

const port = Number(process.env.TARGET_PORT) || 0;
if (port > 0) {
  process.env.APP_ORIGIN = `http://localhost:${port}`;
  process.env.PORT = String(port);
} else {
  delete process.env.APP_ORIGIN;
  process.env.PORT = "3000";
}

async function main() {
  const instance = await startServer(port);
  const address = instance.httpServer.address();
  const actualPort =
    typeof address === "object" && address !== null ? address.port : port;

  process.env.APP_ORIGIN = `http://localhost:${actualPort}`;
  process.env.PORT = String(actualPort);
  if (process.send) {
    process.send({
      type: "started",
      port: actualPort,
      origin: `http://localhost:${actualPort}`,
    });
  }

  const shutdown = async () => {
    try {
      await instance.dispose();
    } catch (err) {
      console.error("[server-runner] Dispose error:", err);
    }
    process.exit(0);
  };

  process.on("message", (msg: unknown) => {
    if (
      msg &&
      typeof msg === "object" &&
      "type" in msg &&
      msg.type === "stop"
    ) {
      void shutdown();
    }
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
}

main().catch((err) => {
  console.error("[server-runner] Startup failure:", err);
  process.exit(1);
});
