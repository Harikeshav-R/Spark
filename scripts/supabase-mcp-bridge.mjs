#!/usr/bin/env node
// ==============================================================================
// Spark: Local Supabase MCP Bridge (Stdio -> Local Supabase Studio)
// Bridges stdio JSON-RPC from AI coding agents (Claude Code, Cursor, OMP)
// to the local/self-hosted Supabase Studio StreamableHTTP MCP server.
// ==============================================================================

import readline from "node:readline";
import process from "node:process";
import console from "node:console";
const SUPABASE_MCP_URL =
  process.env.SUPABASE_MCP_URL || "http://127.0.0.1:54323/api/mcp";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    console.error("[Supabase MCP Bridge] Failed to parse JSON-RPC line:", line);
    return;
  }

  try {
    const res = await globalThis.fetch(SUPABASE_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: trimmed,
    });

    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 0) {
        process.stdout.write(text.trim() + "\n");
      }
    } else {
      const errText = await res.text();
      console.error(
        `[Supabase MCP Bridge] HTTP ${res.status} from ${SUPABASE_MCP_URL}:`,
        errText
      );
      if (parsed.id !== undefined && parsed.id !== null) {
        const errorResponse = {
          jsonrpc: "2.0",
          id: parsed.id,
          error: {
            code: -32603,
            message: `Supabase local MCP error (${res.status}): ${errText || res.statusText}`,
          },
        };
        process.stdout.write(JSON.stringify(errorResponse) + "\n");
      }
    }
  } catch (err) {
    console.error(
      `[Supabase MCP Bridge] Failed to connect to ${SUPABASE_MCP_URL}: ${err.message}`
    );
    console.error(
      `[Supabase MCP Bridge] Ensure local Supabase is running (e.g. npx supabase start).`
    );
    if (parsed.id !== undefined && parsed.id !== null) {
      const errorResponse = {
        jsonrpc: "2.0",
        id: parsed.id,
        error: {
          code: -32002,
          message: `Cannot connect to local Supabase at ${SUPABASE_MCP_URL}. Ensure local Supabase containers are active.`,
        },
      };
      process.stdout.write(JSON.stringify(errorResponse) + "\n");
    }
  }
});
