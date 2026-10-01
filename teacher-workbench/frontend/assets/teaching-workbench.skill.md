# Teaching Workbench MCP Skill

Use the user's own AI Agent to install and operate the Teaching Workbench MCP service.

## Setup

1. Ask the user for the GitHub repository URL if it is not already known.
2. Download or clone the repository.
3. Run `npm install` inside the `mcp` directory.
4. Ask the user to generate a permanent MCP Token from Workbench v2 > AI Agent / MCP.
5. Ask the user to provide the token only for writing to the local MCP client environment variable `WB_API_TOKEN`. Never put it in chat history, a prompt, a URL, or source code.
6. Configure the MCP client to start `node mcp/src/index.js` with `WB_API_TOKEN` in its environment.
7. Run a read-only workspace test before any write operation.

## Rules

- Read workspace context before acting.
- Keep tenant and academic year explicit.
- Write tools require a user-visible preview, `confirm: true`, and a unique `client_mutation_id`.
- Never request passwords, cookies, or unrelated secrets.
- Never access arbitrary URLs, SQL, files, or shell commands through MCP.
- On a conflict or permission error, stop and re-read the workspace.
