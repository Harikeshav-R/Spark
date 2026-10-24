#!/usr/bin/env bash
# ==============================================================================
# Spark: Automated Agent Tooling & MCP Server Installer
# Installs and validates codebase-memory-mcp and agentation-mcp for coding agents.
# ==============================================================================
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

echo -e "${BOLD}Checking Spark Agent Tooling & MCP Prerequisites...${RESET}"

# 1. Ensure ~/.local/bin exists and is on PATH
mkdir -p "${HOME}/.local/bin"
export PATH="${HOME}/.local/bin:${PATH}"

# 2. Check and install codebase-memory-mcp
echo -e "\n${BOLD}[1/2] Verifying codebase-memory-mcp...${RESET}"
if command -v codebase-memory-mcp >/dev/null 2>&1; then
    echo -e "${GREEN}✓ codebase-memory-mcp found:${RESET} $(command -v codebase-memory-mcp) ($(codebase-memory-mcp --version 2>/dev/null || echo 'installed'))"
else
    echo -e "${YELLOW}! codebase-memory-mcp not found in PATH. Installing via official installer...${RESET}"
    curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
    export PATH="${HOME}/.local/bin:${PATH}"
    if command -v codebase-memory-mcp >/dev/null 2>&1; then
        echo -e "${GREEN}✓ codebase-memory-mcp successfully installed:${RESET} $(codebase-memory-mcp --version)"
    else
        echo -e "${RED}✗ Failed to install codebase-memory-mcp. Please run manually:${RESET}"
        echo "  curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash"
    fi
fi

# 3. Check and install agentation-mcp
echo -e "\n${BOLD}[2/2] Verifying agentation-mcp...${RESET}"
if command -v agentation-mcp >/dev/null 2>&1; then
    echo -e "${GREEN}✓ agentation-mcp found:${RESET} $(command -v agentation-mcp)"
else
    echo -e "${YELLOW}! agentation-mcp binary not found. Checking npm global or creating local wrapper...${RESET}"
    if npm install -g agentation-mcp >/dev/null 2>&1; then
        echo -e "${GREEN}✓ agentation-mcp installed globally via npm${RESET}"
    else
        echo -e "${YELLOW}Global npm install not permitted. Creating wrapper in ~/.local/bin/agentation-mcp...${RESET}"
        cat << 'EOF' > "${HOME}/.local/bin/agentation-mcp"
#!/usr/bin/env bash
exec npx -y agentation-mcp "$@"
EOF
        chmod +x "${HOME}/.local/bin/agentation-mcp"
        echo -e "${GREEN}✓ Created wrapper in ~/.local/bin/agentation-mcp${RESET}"
    fi
fi

# 4. Verify project configs
echo -e "\n${BOLD}[Verification] Checking Project MCP and Skills Configs...${RESET}"
node -e '
const fs = require("fs");
const files = ["mcp.json", ".claude/mcp.json", ".omp/mcp.json"];
for (const file of files) {
  if (fs.existsSync(file)) {
    JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(`  ✓ ${file} valid`);
  }
}
const skills = fs.readdirSync(".agents/skills");
console.log(`  ✓ ${skills.length} skills ready in .agents/skills`);
'

echo -e "\n${GREEN}${BOLD}Agent tooling setup complete!${RESET}\n"
