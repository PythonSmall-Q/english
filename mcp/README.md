# Teacher Workbench MCP

This package lets a user's own AI Agent operate the English Teacher Workbench through the v2 API.

## Install

1. Download `https://fff-file-r2-cloudflare.xmoj-script.uk/teacher-workbench-mcp-3.1.0.zip` from the Workbench MCP page.
2. Extract it.
3. Run `npm install` in the extracted directory.
4. Generate a permanent MCP Token in Workbench v2 > AI Agent / MCP.
5. Configure the MCP client with `WB_API_TOKEN` in its environment.
6. Start `node src/index.js`.

The MCP server never reads D1, R2, browser cookies, or passwords directly. It only calls the Workbench v2 API.

Write tools require explicit `confirm: true` and a unique `client_mutation_id`.
