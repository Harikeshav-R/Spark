#!/usr/bin/env node
// ==============================================================================
// Spark: Automated Agent Tooling & MCP Server Installer
// Ensures complete local environment replication for all teammates and agents.
// Cross-platform Node.js implementation for Windows, macOS, and Linux.
// ==============================================================================

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import process from "node:process";
import console from "node:console";

const isTTY = process.stdout.isTTY;
const BOLD = isTTY ? "\x1b[1m" : "";
const GREEN = isTTY ? "\x1b[32m" : "";
const YELLOW = isTTY ? "\x1b[33m" : "";
const RED = isTTY ? "\x1b[31m" : "";
const CYAN = isTTY ? "\x1b[36m" : "";
const RESET = isTTY ? "\x1b[0m" : "";

const isWindows = process.platform === "win32";

console.log(`${BOLD}${CYAN}=== Spark Agent Tooling & MCP Environment Setup ===${RESET}`);

// 1. Ensure local bin directory exists and is on PATH
const homeDir = os.homedir();
const localBin = path.join(homeDir, ".local", "bin");
try {
  fs.mkdirSync(localBin, { recursive: true });
} catch {
  // Ignore error if directory already exists or permission denied
}

if (!process.env.PATH?.includes(localBin)) {
  process.env.PATH = `${localBin}${path.delimiter}${process.env.PATH || ""}`;
}

// 2. Verify and repair symlinks for agent harnesses
console.log(`\n${BOLD}[1/4] Verifying Skill Directory Symlinks...${RESET}`);

const agentsSkillsDir = path.resolve(".agents", "skills");
fs.mkdirSync(agentsSkillsDir, { recursive: true });
fs.mkdirSync(".claude", { recursive: true });
fs.mkdirSync(".omp", { recursive: true });

if (!fs.existsSync(agentsSkillsDir)) {
  console.error(`${RED}✗ .agents/skills not found in repo root.${RESET}`);
  process.exit(1);
}

for (const client of [".claude", ".omp"]) {
  const target = path.join(client, "skills");
  let needLink = false;

  try {
    const stat = fs.lstatSync(target);
    if (!stat.isSymbolicLink() && !stat.isDirectory()) {
      fs.rmSync(target, { force: true });
      needLink = true;
    } else if (stat.isSymbolicLink()) {
      // Verify symlink target exists/points correctly
      try {
        fs.statSync(target);
        console.log(`${GREEN}✓ ${target} symlink verified${RESET}`);
      } catch {
        // Broken symlink
        fs.rmSync(target, { force: true });
        needLink = true;
      }
    } else {
      // It's a directory (might be a copied directory or junction)
      console.log(`${GREEN}✓ ${target} directory verified${RESET}`);
    }
  } catch {
    needLink = true;
  }

  if (needLink) {
    try {
      const symlinkTarget = isWindows ? path.resolve(agentsSkillsDir) : "../.agents/skills";
      const symlinkType = isWindows ? "junction" : "dir";
      fs.symlinkSync(symlinkTarget, target, symlinkType);
      console.log(`${GREEN}✓ Created ${target} link to .agents/skills${RESET}`);
    } catch {
      try {
        fs.cpSync(agentsSkillsDir, target, { recursive: true });
        console.log(`${GREEN}✓ Copied .agents/skills to ${target} (symlink fallback)${RESET}`);
      } catch (err) {
        console.error(`${RED}✗ Failed to link or copy to ${target}: ${err.message}${RESET}`);
      }
    }
  }
}

// Helper to run command safely
function runCmd(cmd) {
  try {
    return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

// 3. Check and install codebase-memory-mcp
console.log(`\n${BOLD}[2/4] Verifying codebase-memory-mcp...${RESET}`);

const memoryVersion = runCmd("codebase-memory-mcp --version");
if (memoryVersion !== null) {
  console.log(`${GREEN}✓ codebase-memory-mcp binary found:${RESET} (${memoryVersion || "installed"})`);
} else {
  console.log(`${YELLOW}! codebase-memory-mcp not found in PATH.${RESET}`);
  if (isWindows) {
    console.log(`  To install on Windows:`);
    console.log(`  Run in Git Bash or WSL: curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash`);
    console.log(`  Or see: https://github.com/DeusData/codebase-memory-mcp`);
  } else {
    console.log(`${YELLOW}! Installing via official installer...${RESET}`);
    try {
      execSync("curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash", {
        stdio: "inherit",
      });
      const installedVer = runCmd("codebase-memory-mcp --version");
      if (installedVer !== null) {
        console.log(`${GREEN}✓ codebase-memory-mcp successfully installed:${RESET} (${installedVer || "installed"})`);
      } else {
        console.log(`${RED}✗ Failed to install codebase-memory-mcp.${RESET}`);
        console.log("  Manual install: curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash");
      }
    } catch {
      console.log(`${RED}✗ Failed to install codebase-memory-mcp.${RESET}`);
      console.log("  Manual install: curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash");
    }
  }
}

// 4. Check uv/uvx for fetch MCP
console.log(`\n${BOLD}[3/4] Verifying uv / uvx (for fetch MCP)...${RESET}`);

const uvxVersion = runCmd("uvx --version");
if (uvxVersion !== null) {
  console.log(`${GREEN}✓ uvx found:${RESET} ${uvxVersion}`);
} else {
  console.log(`${YELLOW}! uv / uvx not found.${RESET}`);
  if (isWindows) {
    console.log(`  To install on Windows:`);
    console.log(`  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`);
  } else {
    console.log(`${YELLOW}! Installing Astral uv...${RESET}`);
    try {
      execSync("curl -LsSf https://astral.sh/uv/install.sh | sh", { stdio: "inherit" });
      const uvxInstalled = runCmd("uvx --version");
      if (uvxInstalled !== null) {
        console.log(`${GREEN}✓ uvx installed:${RESET} ${uvxInstalled}`);
      } else {
        console.log(`${YELLOW}! Could not auto-install uv. If using 'fetch' MCP, install via: curl -LsSf https://astral.sh/uv/install.sh | sh${RESET}`);
      }
    } catch {
      console.log(`${YELLOW}! Could not auto-install uv. If using 'fetch' MCP, install via: curl -LsSf https://astral.sh/uv/install.sh | sh${RESET}`);
    }
  }
}

// 5. Check Node & npx
console.log(`\n${BOLD}[4/4] Verifying Node.js & npx...${RESET}`);

const npxVersion = runCmd("npx --version");
if (npxVersion !== null) {
  console.log(`${GREEN}✓ npx found:${RESET} ${npxVersion}`);
} else {
  console.log(`${RED}✗ npx not found in PATH. Node.js is required for Spark.${RESET}`);
}

// 6. Validate project MCP and skill configs
console.log(`\n${BOLD}[Verification] Checking Project MCP and Skills Configs...${RESET}`);

const files = ["mcp.json", ".claude/mcp.json", ".omp/mcp.json"];
for (const file of files) {
  if (fs.existsSync(file)) {
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
      console.log(`  ${GREEN}✓${RESET} ${file} valid JSON`);
    } catch (err) {
      console.error(`  ${RED}✗${RESET} ${file} invalid JSON: ${err.message}`);
    }
  }
}

try {
  const skills = fs.readdirSync(".agents/skills");
  console.log(`  ${GREEN}✓${RESET} ${skills.length} skills ready in .agents/skills`);
} catch (err) {
  console.error(`  ${RED}✗${RESET} could not read .agents/skills: ${err.message}`);
}

console.log(`\n${GREEN}${BOLD}=== Spark Agent Tooling Setup Complete! ===${RESET}\n`);
