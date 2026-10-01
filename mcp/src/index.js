import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const apiBase = (process.env.WB_API_BASE || 'https://fff-api.xmoj-script.uk/api/v2').replace(/\/$/, '');
const token = process.env.WB_API_TOKEN;

if (!token) {
  console.error('WB_API_TOKEN is required. Generate it once from Workbench v2 Settings > AI Agent & MCP.');
  process.exit(1);
}

async function callApi(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.message || `Workbench API failed (${response.status})`);
  }
  return payload.data;
}

const server = new McpServer({ name: 'teacher-workbench', version: '0.1.0' });

server.registerTool('get_workspace_context', {
  description: 'Read the current teaching workspace, tenant, academic year, classes, schedule and pending work.',
  inputSchema: z.object({}),
}, async () => ({ content: [{ type: 'text', text: JSON.stringify(await callApi('/context'), null, 2) }] }));

server.registerTool('list_dictations', {
  description: 'List recent dictations and their passed, failed and retest counts.',
  inputSchema: z.object({}),
}, async () => ({ content: [{ type: 'text', text: JSON.stringify(await callApi('/dictations'), null, 2) }] }));

server.registerTool('list_assignments', {
  description: 'List recent assignments and submission summaries.',
  inputSchema: z.object({}),
}, async () => ({ content: [{ type: 'text', text: JSON.stringify(await callApi('/assignments'), null, 2) }] }));

server.registerTool('record_dictation_results', {
  description: 'Record dictation results. Requires explicit confirm=true after showing the exact student IDs and result lists to the user.',
  inputSchema: z.object({
    dictation_id: z.string().min(1),
    passed: z.array(z.string()).default([]),
    failed: z.array(z.string()).default([]),
    client_mutation_id: z.string().min(8),
    confirm: z.literal(true),
  }),
}, async ({ dictation_id, passed, failed, client_mutation_id }) => ({
  content: [{ type: 'text', text: JSON.stringify(await callApi('/commands', {
    method: 'POST',
    body: { commands: [{ type: 'record_dictation_results', target: { id: dictation_id }, payload: { passed, failed }, client_mutation_id }] },
  }), null, 2) }],
}));

server.registerTool('mark_retest_completed', {
  description: 'Mark selected students as having completed retest. Requires explicit confirm=true.',
  inputSchema: z.object({
    dictation_id: z.string().min(1),
    student_ids: z.array(z.string()).min(1),
    client_mutation_id: z.string().min(8),
    confirm: z.literal(true),
  }),
}, async ({ dictation_id, student_ids, client_mutation_id }) => ({
  content: [{ type: 'text', text: JSON.stringify(await callApi('/commands', {
    method: 'POST',
    body: { commands: [{ type: 'mark_retest_completed', target: { id: dictation_id }, payload: { student_ids }, client_mutation_id }] },
  }), null, 2) }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Teacher Workbench MCP server started');
