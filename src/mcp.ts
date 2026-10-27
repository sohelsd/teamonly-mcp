// npx teamonly mcp: an MCP server over stdio, for AI tools that call tools instead of running
// commands. Each tool runs this same CLI as a child process without a terminal, so it takes the
// non-interactive paths the CLI already has (email-code sign-in, --yes, secrets from stdin) and
// the output is exactly what a person would see. stdout carries only JSON-RPC; logs go to stderr.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PKG_ROOT, VERSION } from './init.ts';

const CLI = fileURLToPath(import.meta.url);
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `TeamOnly puts internal apps online behind the company login: only people with an email at the company's domain can open them. Each app gets its own database (D1), file storage and secrets.

Before writing or changing app code, call get_app_rules and follow it exactly. The only supported stack is a React + Vite front end with a Hono API on one Cloudflare Worker and a D1 database. Never add Express, Next.js, Supabase, Firebase, Prisma or any login code: sign-in is already done before a request reaches the app, and the app reads the person from ctx.user.

Usual order: init (in the app's folder) -> build the app -> deploy. If deploy says you're not signed in: sign_in with the person's work email, ask them for the 6-digit code from that email, sign_in again with the code, then start_trial if the company is new. Every tool takes "directory", the absolute path of the app's folder (the one with teamonly.json).`;

type Props = Record<string, { type: string; description: string; enum?: string[]; items?: { type: string } }>;
type Tool = {
  name: string;
  title: string;
  description: string;
  props?: Props;
  required?: string[];
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (a: Record<string, unknown>, dir: string) => Promise<Result> | Result;
};
type Result = { text: string; error?: boolean };

const directory = { type: 'string', description: "Absolute path of the app's folder (the one with teamonly.json). Defaults to the folder the server started in." };
const emails = { type: 'array', items: { type: 'string' }, description: 'Work email addresses' };
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v).split(/[\s,]+/).filter(Boolean));

/** Runs `teamonly <args>` in dir. Stops it after `seconds` if given (for the live log stream). */
function cli(args: string[], dir: string, opts: { input?: string; seconds?: number } = {}): Promise<Result> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: dir,
      env: { ...process.env, NO_COLOR: '1', TEAMONLY_MCP: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.stdin.end(opts.input ?? '');
    const timer = opts.seconds ? setTimeout(() => child.kill('SIGINT'), opts.seconds * 1000) : undefined;
    child.on('error', (e) => done({ text: e.message, error: true }));
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      // eslint-disable-next-line no-control-regex
      const text = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').trim() || '(no output)';
      done({ text, error: code !== 0 && !opts.seconds });
    });
  });
}

const rules = () => {
  const block = readFileSync(join(PKG_ROOT, 'skill', 'AGENTS.md'), 'utf8');
  return block.replace(/<!-- teamonly:(start|end) -->\n?/g, '').trim();
};

const TOOLS: Tool[] = [
  {
    name: 'get_app_rules',
    title: 'How to write a TeamOnly app',
    description: 'The rules for writing an app that deploys on TeamOnly: the supported stack, how to read the signed-in person, the database, files, secrets, email to coworkers, scheduled jobs and roles. Read this before writing or changing app code.',
    annotations: { readOnlyHint: true },
    run: () => ({ text: rules() }),
  },
  {
    name: 'init',
    title: 'Set up a folder for TeamOnly',
    description: 'In an empty folder, creates a starter app (or a ready-made one with "template"). In a folder with an existing app, adds teamonly.json and the TeamOnly instructions for Claude Code, Cursor and other AI tools. Leave "template" out to see the template list in the result.',
    props: { directory, template: { type: 'string', description: 'Optional: expense-approval, customer-lookup, inventory-tracker, request-form or ask-the-docs' } },
    run: async (a, dir) => {
      const t = str(a.template);
      const r = await cli(['init', ...(t ? ['--template', t] : [])], dir);
      if (t || r.error) return r;
      const templates = await cli(['templates'], dir);
      return { text: `${r.text}\n\n${templates.text}` };
    },
  },
  {
    name: 'deploy',
    title: 'Deploy the app',
    description: 'Builds the app in "directory" and puts it online at https://<app>.<company>.teamonly.app, behind the company login. Takes up to a minute. If the person is not signed in, the result says what to do (use sign_in).',
    props: { directory },
    annotations: { openWorldHint: true },
    run: (_a, dir) => cli(['deploy'], dir),
  },
  {
    name: 'versions',
    title: 'List the app\'s versions',
    description: 'Lists the deployed versions of the app, newest first: number, when, who deployed it, and which one is live. The last 10 can be put back with rollback.',
    props: { directory },
    annotations: { readOnlyHint: true },
    run: (_a, dir) => cli(['versions'], dir),
  },
  {
    name: 'rollback',
    title: 'Put an earlier version back',
    description: 'Puts the previous version of the app back live (or "version", a number from versions). Use it when a deploy broke the app and the person wants the last working one back now. Code, pages and scheduled jobs go back; the database is not changed.',
    props: { directory, version: { type: 'number', description: 'Optional: the version number to put back' } },
    annotations: { openWorldHint: true },
    run: (a, dir) => cli(['rollback', ...(Number.isInteger(Number(a.version)) && a.version !== undefined ? [String(a.version)] : [])], dir),
  },
  {
    name: 'status',
    title: 'Who is signed in, plan and apps',
    description: 'Shows who is signed in to TeamOnly on this computer, the company and plan (with free trial days left), and every app with its address, who can open it and when it was last deployed.',
    annotations: { readOnlyHint: true },
    run: (_a, dir) => cli(['whoami'], dir),
  },
  {
    name: 'logs',
    title: 'Watch the live app',
    description: "Collects the live app's requests, console.log output and errors for a few seconds and returns them. Ask the person to open the app (or trigger the problem) while it runs.",
    props: { directory, seconds: { type: 'number', description: 'How long to watch, 5 to 60 seconds (default 20)' } },
    annotations: { readOnlyHint: true },
    run: async (a, dir) => {
      const s = Math.min(60, Math.max(5, Number(a.seconds) || 20));
      const r = await cli(['logs'], dir, { seconds: s });
      // Only the "Showing live logs" line: nothing reached the app while we watched.
      if (!r.error && r.text.split('\n').length === 1 && r.text.startsWith('✔')) {
        return { text: `Nothing reached the app in those ${s} seconds. Ask the person to open the app or repeat what went wrong, then call logs again.` };
      }
      return { ...r, text: r.text.replace(/ Press Ctrl\+C to stop\./, '') };
    },
  },
  {
    name: 'access',
    title: 'Who can open the app',
    description: 'Shows or changes who can open the app. "show" (default), "everyone" (everyone at the company), "only" (only these people and the owner), "add" or "remove" people on that list.',
    props: { directory, action: { type: 'string', enum: ['show', 'everyone', 'only', 'add', 'remove'], description: 'What to do' }, emails },
    annotations: { openWorldHint: true },
    run: (a, dir) => {
      const action = str(a.action) || 'show';
      return cli(['access', ...(action === 'show' ? [] : [action, ...list(a.emails)])], dir);
    },
  },
  {
    name: 'roles',
    title: 'Roles inside the app',
    description: 'Shows or changes the roles people have inside the app (the app reads them as ctx.user.roles), such as approver or finance. "show" (default), "add" or "remove" a role for some people.',
    props: { directory, action: { type: 'string', enum: ['show', 'add', 'remove'], description: 'What to do' }, role: { type: 'string', description: 'Role name, e.g. approver' }, emails },
    annotations: { openWorldHint: true },
    run: (a, dir) => {
      const action = str(a.action) || 'show';
      return cli(['roles', ...(action === 'show' ? [] : [action, str(a.role), ...list(a.emails)])], dir);
    },
  },
  {
    name: 'set_secret',
    title: 'Save a secret',
    description: 'Saves a secret (API key, password) for the deployed app. The app reads it with ctx.secrets.get(NAME). Names are UPPER_SNAKE_CASE. Ask the person for the value; never put it in code.',
    props: { directory, name: { type: 'string', description: 'e.g. OPENAI_API_KEY' }, value: { type: 'string', description: 'The secret value' } },
    required: ['name', 'value'],
    annotations: { idempotentHint: true, openWorldHint: true },
    run: (a, dir) => cli(['secrets', 'set', str(a.name)], dir, { input: String(a.value ?? '') }),
  },
  {
    name: 'sign_in',
    title: 'Sign in with a work email',
    description: 'Signs in to TeamOnly on this computer. Call it with "email" first: TeamOnly emails that address a 6-digit code. Ask the person for the code, then call again with "code". If their company is new, the result says so; then use start_trial.',
    props: { email: { type: 'string', description: 'Work email address' }, code: { type: 'string', description: 'The 6-digit code from the email' } },
    annotations: { openWorldHint: true },
    run: async (a, dir) => {
      const code = str(a.code);
      if (code) return cli(['login', '--code', code], dir);
      const email = str(a.email);
      if (!email) return { text: 'Give "email" (a work address) to get a sign-in code, then call again with "code".', error: true };
      const r = await cli(['login', '--email', email], dir);
      return r.error ? r : { text: `${r.text}\n\nAsk the person for the 6-digit code from that email, then call sign_in with "code".` };
    },
  },
  {
    name: 'start_trial',
    title: 'Start a free 14-day trial',
    description: "For a company that doesn't have TeamOnly yet, after sign_in verified the email: starts a free 14-day trial (one builder, up to 3 apps, no card).",
    props: { company: { type: 'string', description: "The company's name" } },
    annotations: { openWorldHint: true },
    run: (a, dir) => cli(['trial', ...(str(a.company) ? ['--company', str(a.company)] : [])], dir),
  },
  {
    name: 'subscribe',
    title: 'Pick a paid plan',
    description: "Starts paying for TeamOnly (also ends a free trial): opens a payment page in the person's browser and returns its link. The person pays there; call subscribe again afterwards to finish. Plans: builder ($19/mo, one builder, 3 apps), team ($249/mo, unlimited apps and builders), business ($899/mo, adds SSO and audit logs).",
    props: { plan: { type: 'string', enum: ['builder', 'team', 'business'], description: 'Plan' }, company: { type: 'string', description: "The company's name" } },
    required: ['plan'],
    annotations: { openWorldHint: true },
    run: (a, dir) => cli(['subscribe', '--no-wait', '--plan', str(a.plan), ...(str(a.company) ? ['--company', str(a.company)] : [])], dir),
  },
  {
    name: 'delete_app',
    title: 'Delete the app',
    description: 'Deletes the live app with its database, files and secrets. It cannot be undone. Only call this when the person asked for it, and pass the app name (from teamonly.json) as "confirm".',
    props: { directory, confirm: { type: 'string', description: 'The app name, to confirm' } },
    required: ['confirm'],
    annotations: { destructiveHint: true, openWorldHint: true },
    run: (a, dir) => {
      let name = '';
      try { name = JSON.parse(readFileSync(join(dir, 'teamonly.json'), 'utf8')).name; } catch {}
      if (!name || str(a.confirm) !== name) return { text: `Nothing was deleted: "confirm" must be the app name${name ? ` (${name})` : ''}.`, error: true };
      return cli(['delete', '--yes'], dir);
    },
  },
];

function folder(arg: unknown, start: string): string {
  const d = str(arg);
  if (!d) return start;
  const full = isAbsolute(d) ? d : resolve(start, d);
  if (!existsSync(full)) throw new Error(`The folder ${full} does not exist.`);
  return full;
}

type Message = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export async function handle(msg: Message, start: string): Promise<object | null> {
  const reply = (result: object) => ({ jsonrpc: '2.0', id: msg.id, result });
  const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined || msg.id === null) return null; // a notification
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'teamonly', title: 'TeamOnly', version: VERSION, websiteUrl: 'https://teamonly.dev' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: { type: 'object', properties: t.props ?? {}, ...(t.required && { required: t.required }) },
          ...(t.annotations && { annotations: { title: t.title, ...t.annotations } }),
        })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return error(-32602, `Unknown tool: ${String(msg.params?.name)}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const r = await tool.run(args, folder(args.directory, start));
        return reply({ content: [{ type: 'text', text: r.text }], isError: Boolean(r.error) });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
      }
    }
    default:
      return error(-32601, `Method not found: ${msg.method}`);
  }
}

export function mcp() {
  const start = process.cwd();
  const send = (m: object) => process.stdout.write(JSON.stringify(m) + '\n');
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg: Message;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const out = await handle(msg, start);
    if (out) send(out);
  });
  // Keep running until the client closes stdin.
  return new Promise<void>((r) => rl.on('close', r));
}
