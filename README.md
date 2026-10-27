# TeamOnly MCP server

Deploy the internal apps you build with AI behind your company login, from Claude Code, Cursor, Claude Desktop, VS Code, Windsurf or any MCP client.

Say "deploy this on TeamOnly" and your agent puts the app online at `https://<app>.<company>.teamonly.app`. Only people with an email at your company can open it: they sign in with their work Google or Microsoft account, or a code sent to their work email. The app gets its own database, file storage and secrets. Free for 14 days, no card.

Website: [teamonly.dev/mcp](https://teamonly.dev/mcp?ref=github-mcp) · npm: [teamonly](https://www.npmjs.com/package/teamonly) · MCP Registry: `dev.teamonly/teamonly`

## Install

The server is part of the `teamonly` npm package and runs on your computer (deploying reads your project's files). It needs Node.js 20 or newer (22 for `logs`).

**Claude Code**

```sh
claude mcp add teamonly -- npx -y teamonly mcp
```

**Cursor:** [Add to Cursor](https://cursor.com/en/install-mcp?name=teamonly&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInRlYW1vbmx5IiwibWNwIl19), or put this in `~/.cursor/mcp.json`. Claude Desktop (`claude_desktop_config.json`) and Windsurf take the same:

```json
{
  "mcpServers": {
    "teamonly": { "command": "npx", "args": ["-y", "teamonly", "mcp"] }
  }
}
```

**VS Code**

```sh
code --add-mcp '{"name":"teamonly","command":"npx","args":["-y","teamonly","mcp"]}'
```

## Tools

| Tool | What it does |
|---|---|
| `get_app_rules` | The rules for an app that deploys: React + Vite front end, Hono API on one Cloudflare Worker, D1 database, and how to read the signed-in person. The agent reads this before writing code. |
| `init` | Starts an app in an empty folder (or from a template), or adds TeamOnly to an app you already have. |
| `deploy` | Builds the app and puts it online behind your company login. |
| `versions` | Lists the app's versions: when, who deployed each, and which is live. |
| `rollback` | Puts the previous version (or a chosen one) back live in seconds. |
| `pull` | Downloads a deployed app's code into a new folder, so you can change an app whose code isn't on your computer. Owner or admin. |
| `status` | Who is signed in, the plan, and every app with who can open it. |
| `logs` | Watches the live app's requests, `console.log` output and errors for 5 to 60 seconds. |
| `access` | Who can open the app: everyone at the company, or a list of people. |
| `roles` | Roles people have inside the app, like approver or finance. |
| `set_secret` | Saves an API key or password for the app. |
| `sign_in` | Signs in with a work email and the 6-digit code TeamOnly emails. |
| `start_trial` | Starts the free 14-day trial for a company new to TeamOnly. |
| `subscribe` | Returns a payment link for a paid plan. |
| `delete_app` | Deletes the app and its data. Needs the app name to confirm. |

## How sign-in works

There are no API keys to paste. The agent asks for your work email, calls `sign_in`, and asks you for the code from the email. If your company is new to TeamOnly it offers the free trial. The sign-in is saved on your computer in `~/.teamonly`, shared with the `npx teamonly` command line tool.

## Example

> Build a tool where people submit expenses and their manager approves them. Deploy it on TeamOnly so only people at our company can open it.

## Templates

Five ready-made internal tools (expense approval, customer lookup, inventory tracker, request form, ask the docs): [sohelsd/teamonly-templates](https://github.com/sohelsd/teamonly-templates).

## Source

[`src/mcp.ts`](src/mcp.ts) is the server. It ships inside the `teamonly` npm package next to the command line tool it runs: each tool call runs the matching `teamonly` command without a terminal and returns its output, so the MCP tools and the CLI always behave the same. This copy is updated with each release. The [Dockerfile](Dockerfile) runs the published package.

## License

This repository is MIT licensed. The `teamonly` npm package it runs has [its own license](https://www.npmjs.com/package/teamonly?activeTab=code).

## Support

Email hello@teamonly.dev.
