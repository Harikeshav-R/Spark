#!/usr/bin/env bash
# ==============================================================================
# Spark: Automated Agent Tooling & MCP Server Installer
# Ensures complete local environment replication for all teammates and agents.
# ==============================================================================
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}=== Spark Agent Tooling & MCP Environment Setup ===${RESET}"

# 1. Ensure ~/.local/bin exists and is on PATH
mkdir -p "${HOME}/.local/bin"
export PATH="${HOME}/.local/bin:${PATH}"

# 2. Verify and repair symlinks for agent harnesses
echo -e "\n${BOLD}[1/5] Verifying Skill Directory Symlinks...${RESET}"
mkdir -p .agents/skills .claude .omp

if [ ! -d ".agents/skills" ]; then
    echo -e "${RED}✗ .agents/skills not found in repo root.${RESET}"
    exit 1
fi

for client in ".claude" ".omp"; do
    target="${client}/skills"
    if [ ! -e "${target}" ] || [ -f "${target}" ]; then
        rm -f "${target}"
        ln -sfn ../.agents/skills "${target}" || cp -R .agents/skills "${target}"
        echo -e "${GREEN}✓ Created ${target} link to .agents/skills${RESET}"
    else
        echo -e "${GREEN}✓ ${target} symlink verified${RESET}"
    fi
done

# 3. Check and install codebase-memory-mcp
echo -e "\n${BOLD}[2/5] Verifying codebase-memory-mcp...${RESET}"
if command -v codebase-memory-mcp >/dev/null 2>&1; then
    echo -e "${GREEN}✓ codebase-memory-mcp binary found:${RESET} $(command -v codebase-memory-mcp) ($(codebase-memory-mcp --version 2>/dev/null || echo 'installed'))"
else
    echo -e "${YELLOW}! codebase-memory-mcp not found in PATH. Installing via official installer...${RESET}"
    curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
    export PATH="${HOME}/.local/bin:${PATH}"
    if command -v codebase-memory-mcp >/dev/null 2>&1; then
        echo -e "${GREEN}✓ codebase-memory-mcp successfully installed:${RESET} $(codebase-memory-mcp --version)"
    else
        echo -e "${RED}✗ Failed to install codebase-memory-mcp.${RESET}"
        echo "  Manual install: curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash"
    fi
fi

# 4. Check uv/uvx for fetch MCP
echo -e "\n${BOLD}[3/5] Verifying uv / uvx (for fetch MCP)...${RESET}"
if command -v uvx >/dev/null 2>&1; then
    echo -e "${GREEN}✓ uvx found:${RESET} $(command -v uvx)"
else
    echo -e "${YELLOW}! uv / uvx not found. Installing Astral uv...${RESET}"
    curl -LsSf https://astral.sh/uv/install.sh | sh || true
    export PATH="${HOME}/.cargo/bin:${HOME}/.local/bin:${PATH}"
    if command -v uvx >/dev/null 2>&1; then
        echo -e "${GREEN}✓ uvx installed:${RESET} $(command -v uvx)"
    else
        echo -e "${YELLOW}! Could not auto-install uv. If using 'fetch' MCP, install via: curl -LsSf https://astral.sh/uv/install.sh | sh${RESET}"
    fi
fi

# 5. Check Node & npx (for context7, shadcn, chrome-devtools, playwright, agentation)
echo -e "\n${BOLD}[4/5] Verifying Node.js & npx...${RESET}"
if command -v npx >/dev/null 2>&1; then
    echo -e "${GREEN}✓ npx found:${RESET} $(npx --version)"
else
    echo -e "${RED}✗ npx not found in PATH. Node.js is required for Spark.${RESET}"
fi

# 6. Check optional environment credentials
echo -e "\n${BOLD}[5/5] Checking Environment Credentials...${RESET}"
if [ -n "${GITHUB_TOKEN:-}" ]; then
    echo -e "${GREEN}✓ GITHUB_TOKEN is set${RESET}"
else
    echo -e "${YELLOW}! GITHUB_TOKEN is unset. The 'github' MCP server requires a token in ~/.zshrc or ~/.bashrc.${RESET}"
fi

if [ -n "${DATABASE_URI:-}" ]; then
    echo -e "${GREEN}✓ DATABASE_URI is set${RESET}"
else
    echo -e "${YELLOW}! DATABASE_URI is unset. (Only required if querying PostgreSQL directly via postgres MCP).${RESET}"
fi

# 7. Validate project MCP and skill configs
echo -e "\n${BOLD}[Verification] Checking Project MCP and Skills Configs...${RESET}"
node -e '
const fs = require("fs");
const files = ["mcp.json", ".claude/mcp.json", ".omp/mcp.json"];
for (const file of files) {
  if (fs.existsSync(file)) {
    JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(`  ✓ ${file} valid JSON`);
  }
}
const skills = fs.readdirSync(".agents/skills");
console.log(`  ✓ ${skills.length} skills ready in .agents/skills`);
'

echo -e "\n${GREEN}${BOLD}=== Spark Agent Tooling Setup Complete! ===${RESET}\n"
