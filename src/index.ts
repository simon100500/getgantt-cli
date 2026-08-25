#!/usr/bin/env node
// FILE: src/index.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Provide the public GetGantt CLI commands for authentication and project navigation.
//   SCOPE: Wire Commander commands, profiles, project selection, JSON output, and exit codes.
//   DEPENDS: M-CLI-CONFIG, M-CLI-API, Commander.js
//   LINKS: M-CLI, M-CLI-AUTH, M-CLI-API, M-CLI-CONFIG
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ApiError, GetGanttApiClient, type Project } from './api-client.js';
import { envToken, loadConfig, saveConfig, type CliProfile } from './config.js';
import { print, printError } from './output.js';

function isJson(command: Command): boolean {
  return Boolean(command.optsWithGlobals().json);
}

function baseUrl(command: Command): string {
  const options = command.optsWithGlobals();
  return String(options.server ?? options.apiUrl ?? 'https://ai.getgantt.ru');
}

function timeoutMs(command: Command): number {
  const value = Number.parseInt(String(command.optsWithGlobals().timeout ?? '30000'), 10);
  return Number.isFinite(value) && value >= 0 ? value : 30_000;
}

async function readToken(forceStdin = false): Promise<string> {
  if (forceStdin || !input.isTTY) {
    const value = await new Promise<string>((resolve, reject) => {
      let data = '';
      input.setEncoding('utf8');
      input.on('data', (chunk) => { data += chunk; });
      input.on('end', () => resolve(data.trim()));
      input.on('error', reject);
    });
    if (!value) throw new Error('Token stdin is empty');
    return value;
  }

  output.write('Personal access token: ');
  input.setRawMode?.(true);
  input.resume();
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const onData = (chunk: Buffer) => {
      const char = chunk.toString('utf8');
      if (char === '\u0003') {
        cleanup();
        reject(new Error('Login cancelled'));
      } else if (char === '\r' || char === '\n') {
        cleanup();
        output.write('\n');
        resolve(value.trim());
      } else if (char === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode?.(false);
      input.pause();
    };
    input.on('data', onData);
  });
}

function makeClient(profile: CliProfile, command: Command, tokenOverride?: string): GetGanttApiClient {
  const options = command.optsWithGlobals();
  const requestedBaseUrl = typeof options.server === 'string'
    ? options.server
    : typeof options.apiUrl === 'string'
      ? options.apiUrl
      : undefined;
  return new GetGanttApiClient(requestedBaseUrl || profile.baseUrl || baseUrl(command), tokenOverride ?? envToken() ?? profile.token, timeoutMs(command));
}

type ResolvedClient = { client: GetGanttApiClient; config: Awaited<ReturnType<typeof loadConfig>>; profileName: string; profile: CliProfile };

async function resolveClient(command: Command): Promise<ResolvedClient> {
  const config = await loadConfig();
  const requestedName = command.optsWithGlobals().profile as string | undefined;
  const profileName = requestedName ?? config.currentProfile;
  const storedProfile = config.profiles[profileName];
  const token = envToken();
  if (token) {
    const profile = storedProfile ?? { baseUrl: baseUrl(command), token };
    return { config, profileName: storedProfile ? profileName : 'env', profile, client: makeClient(profile, command, token) };
  }
  if (!storedProfile) throw new Error(`Profile "${profileName}" is not configured. Run: gantt auth login`);
  return { config, profileName, profile: storedProfile, client: makeClient(storedProfile, command) };
}

async function resolveProject(command: Command, resolved: ResolvedClient): Promise<Project> {
  const projectsResult = await resolved.client.projects();
  const explicit = command.optsWithGlobals().project as string | undefined;
  const selector = explicit ?? resolved.profile.projectId;
  const matches = selector
    ? projectsResult.items.filter((project) => project.id === selector || project.name === selector)
    : projectsResult.items.length === 1 ? [projectsResult.items[0]!] : [];
  if (matches.length !== 1) {
    if (matches.length === 0) throw new Error('A single project is required. Use --project or `gantt projects use <id-or-exact-name>`.');
    throw new Error(`Project name is ambiguous: ${selector}`);
  }
  const detail = await resolved.client.project(matches[0]!.id);
  return detail.project;
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (Array.isArray(parsed)) return { items: parsed };
  if (!parsed || typeof parsed !== 'object') throw new Error(`JSON file ${path} must contain an object or array`);
  return parsed as Record<string, unknown>;
}

async function confirmDestructive(message: string): Promise<void> {
  if (!process.stdin.isTTY) throw new Error('Destructive operation requires --yes in non-interactive mode');
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(`${message} [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error('Operation cancelled');
  } finally {
    readline.close();
  }
}

async function callTool(
  command: Command,
  tool: string,
  args: Record<string, unknown>,
  mutating = false,
  dryRun = false,
): Promise<void> {
  const resolved = await resolveClient(command);
  const project = await resolveProject(command, resolved);
  const response = await resolved.client.toolCall({
    projectId: project.id,
    tool,
    arguments: args,
    ...(mutating ? { baseVersion: project.version ?? undefined, idempotencyKey: randomUUID(), dryRun } : {}),
  });
  print(mutating ? { data: response.data, receipt: response.receipt, dryRun, requestId: response.requestId } : response.data, isJson(command), JSON.stringify(mutating ? { ...(response.receipt ?? {}), ...(dryRun ? { status: 'preview' } : {}) } : response.data, null, 2));
}

function exitCodeForError(error: unknown): number {
  if (error instanceof ApiError) {
    if (error.status === 401) return 3;
    if (error.status === 403) return 4;
    if (error.status === 404) return 5;
    if (error.status === 400 || error.status === 422) return 6;
    if (error.status === 409) return 7;
    if (error.status === 429 || error.status >= 500) return 8;
  }
  return 2;
}

const program = new Command()
  .name('gantt')
  .description('GetGantt command-line client')
  .option('--json', 'print machine-readable JSON')
  .option('--server <url>', 'GetGantt server URL')
  .option('--api-url <url>', 'Alias for --server')
  .option('--profile <name>', 'profile name')
  .option('--project <id>', 'project ID or exact name')
  .option('--timeout <ms>', 'HTTP request timeout in milliseconds', '30000');

const auth = program.command('auth').description('Manage personal access tokens and profiles');

auth.command('login')
  .description('validate and save a personal access token')
  .option('--token-stdin', 'read the token from stdin')
  .option('--name <name>', 'profile name', 'default')
  .action(async function (this: Command, options: { tokenStdin?: boolean; name: string }) {
    const command = this.parent?.parent ?? program;
    const token = await readToken(options.tokenStdin);
    const profile: CliProfile = { baseUrl: baseUrl(command), token };
    const client = new GetGanttApiClient(profile.baseUrl, token);
    const me = await client.me();
    const config = await loadConfig();
    config.profiles[options.name] = profile;
    config.currentProfile = options.name;
    await saveConfig(config);
    print({ profile: options.name, user: me.user, token: me.token }, isJson(command), `Logged in as ${me.user.email} (profile: ${options.name})`);
  });

auth.command('status')
  .description('check the active token against the server')
  .action(async function (this: Command) {
    const command = this.parent?.parent ?? program;
    const { client, profileName } = await resolveClient(command);
    const me = await client.me();
    print({ profile: profileName, ...me }, isJson(command), `${me.user.email} — ${me.token.scopes.join(', ') || 'no scopes'}`);
  });

auth.command('logout')
  .description('remove a local profile')
  .option('--name <name>', 'profile name')
  .action(async function (this: Command, options: { name?: string }) {
    const command = this.parent?.parent ?? program;
    const config = await loadConfig();
    const name = options.name ?? config.currentProfile;
    delete config.profiles[name];
    if (config.currentProfile === name) config.currentProfile = Object.keys(config.profiles)[0] ?? 'default';
    await saveConfig(config);
    print({ loggedOut: name }, isJson(command), `Removed profile: ${name}`);
  });

const profiles = auth.command('profiles').description('manage local profiles');

profiles.command('list')
  .description('list local profile names')
  .action(async function (this: Command) {
    const command = this.parent?.parent?.parent ?? program;
    const config = await loadConfig();
    const profiles = Object.keys(config.profiles).map((name) => ({ name, current: name === config.currentProfile, baseUrl: config.profiles[name]!.baseUrl }));
    print({ profiles }, isJson(command), profiles.map((profile) => `${profile.current ? '*' : ' '} ${profile.name} ${profile.baseUrl}`).join('\n'));
  });

profiles.command('use <name>')
  .description('select the active local profile')
  .action(async function (this: Command, name: string) {
    const command = this.parent?.parent?.parent ?? program;
    const config = await loadConfig();
    if (!config.profiles[name]) throw new Error(`Profile "${name}" is not configured`);
    config.currentProfile = name;
    await saveConfig(config);
    print({ currentProfile: name }, isJson(command), `Using profile: ${name}`);
  });

const projects = program.command('projects').description('Inspect and select projects');

projects.command('list')
  .description('list projects available to the active token')
  .action(async function (this: Command) {
    const command = this.parent ?? program;
    const { client } = await resolveClient(command);
    const result = await client.projects();
    print(result, isJson(command), result.items.map((project) => `${project.id}  ${project.name}  (${project.status})`).join('\n'));
  });

projects.command('use <idOrName>')
  .description('set the exact project ID or name for the active profile')
  .action(async function (this: Command, idOrName: string) {
    const command = this.parent ?? program;
    const resolved = await resolveClient(command);
    const result = await resolved.client.projects();
    const matches = result.items.filter((project) => project.id === idOrName || project.name === idOrName);
    if (matches.length !== 1) throw new Error(matches.length === 0 ? `Project not found: ${idOrName}` : `Project name is ambiguous: ${idOrName}`);
    if (!resolved.config.profiles[resolved.profileName]) {
      throw new Error('GETGANTT_TOKEN is supplied by the environment; use --project for CI instead of persisting a selection');
    }
    resolved.profile.projectId = matches[0]!.id;
    resolved.config.profiles[resolved.profileName] = resolved.profile;
    await saveConfig(resolved.config);
    print({ project: matches[0] }, isJson(command), `Using project: ${matches[0]!.name} (${matches[0]!.id})`);
  });

projects.command('current')
  .description('show the selected project')
  .action(async function (this: Command) {
    const command = this.parent ?? program;
    const resolved = await resolveClient(command);
    const project = await resolveProject(command, resolved);
    print({ project }, isJson(command), `${project.name} (${project.id})`);
  });

const project = program.command('project').description('Inspect the selected project');

project.command('show')
  .description('show project metadata and graph version')
  .action(async function (this: Command) {
    const command = this.parent ?? program;
    const resolved = await resolveClient(command);
    const selected = await resolveProject(command, resolved);
    print({ project: selected }, isJson(command), `${selected.name} — version ${selected.version ?? '?'}, ${selected.taskCount ?? 0} tasks`);
  });

const tasks = program.command('tasks').description('Read and change project tasks');

tasks.command('list')
  .description('list tasks in the selected project')
  .option('--limit <number>', 'maximum number of tasks', '500')
  .action(async function (this: Command, options: { limit: string }) {
    const command = this.parent ?? program;
    const resolved = await resolveClient(command);
    const project = await resolveProject(command, resolved);
    const result = await resolved.client.tasks(project.id, Math.min(Math.max(Number.parseInt(options.limit, 10) || 500, 1), 5000));
    print(result, isJson(command), result.items.map((task: any) => `${task.id}  ${task.name}  ${String(task.startDate).slice(0, 10)} → ${String(task.endDate).slice(0, 10)}`).join('\n'));
  });

tasks.command('find <query>')
  .description('find tasks by name')
  .option('--limit <number>', 'maximum matches', '20')
  .action(async function (this: Command, query: string, options: { limit: string }) {
    await callTool(this.parent ?? program, 'find_tasks', { query, limit: Number.parseInt(options.limit, 10) || 20 });
  });

tasks.command('show <taskId>')
  .description('show hierarchy and dependency context for a task')
  .action(async function (this: Command, taskId: string) {
    await callTool(this.parent ?? program, 'get_task_context', { taskId });
  });

tasks.command('create')
  .description('create a relative task graph from a JSON file')
  .requiredOption('--file <path>', 'JSON file containing create_tasks arguments')
  .option('--dry-run', 'preview the mutation without committing it')
  .action(async function (this: Command, options: { file: string; dryRun?: boolean }) {
    await callTool(this.parent ?? program, 'create_tasks', await readJsonFile(options.file), true, options.dryRun);
  });

tasks.command('update')
  .description('update task metadata from a JSON file')
  .requiredOption('--file <path>', 'JSON file containing update_tasks arguments')
  .option('--dry-run', 'preview the mutation without committing it')
  .action(async function (this: Command, options: { file: string; dryRun?: boolean }) {
    await callTool(this.parent ?? program, 'update_tasks', await readJsonFile(options.file), true, options.dryRun);
  });

tasks.command('move')
  .description('move or reparent tasks from a JSON file')
  .requiredOption('--file <path>', 'JSON file containing move_tasks arguments')
  .option('--dry-run', 'preview the mutation without committing it')
  .action(async function (this: Command, options: { file: string; dryRun?: boolean }) {
    await callTool(this.parent ?? program, 'move_tasks', await readJsonFile(options.file), true, options.dryRun);
  });

tasks.command('delete <taskId>')
  .description('delete one task after explicit confirmation')
  .option('--yes', 'confirm destructive operation')
  .option('--dry-run', 'preview the mutation without committing it')
  .action(async function (this: Command, taskId: string, options: { yes?: boolean; dryRun?: boolean }) {
    if (!options.yes && !options.dryRun) await confirmDestructive(`Delete task ${taskId}?`);
    await callTool(this.parent ?? program, 'delete_tasks', { taskIds: [taskId] }, true, options.dryRun);
  });

const dependencies = program.command('dependencies').description('Manage task dependencies');

dependencies.command('link')
  .requiredOption('--from <taskId>', 'predecessor task ID')
  .requiredOption('--to <taskId>', 'successor task ID')
  .option('--type <type>', 'FS, SS, FF, or SF', 'FS')
  .option('--lag <days>', 'signed lag in project days', '0')
  .option('--dry-run', 'preview the mutation without committing it')
  .action(async function (this: Command, options: { from: string; to: string; type: string; lag: string; dryRun?: boolean }) {
    await callTool(this.parent ?? program, 'link_tasks', { links: [{ predecessorTaskId: options.from, successorTaskId: options.to, type: options.type, lag: Number.parseInt(options.lag, 10) || 0 }] }, true, options.dryRun);
  });

dependencies.command('unlink')
  .requiredOption('--from <taskId>', 'predecessor task ID')
  .requiredOption('--to <taskId>', 'successor task ID')
  .option('--dry-run', 'preview the mutation without committing it')
  .action(async function (this: Command, options: { from: string; to: string; dryRun?: boolean }) {
    await callTool(this.parent ?? program, 'unlink_tasks', { links: [{ predecessorTaskId: options.from, successorTaskId: options.to }] }, true, options.dryRun);
  });

const schedule = program.command('schedule').description('Validate and shift the schedule');

schedule.command('validate')
  .description('validate dependencies and schedule health')
  .action(async function (this: Command) {
    await callTool(this.parent ?? program, 'validate_schedule', {});
  });

schedule.command('slice')
  .description('read a bounded schedule slice')
  .option('--start <date>', 'inclusive start date')
  .option('--end <date>', 'inclusive end date')
  .action(async function (this: Command, options: { start?: string; end?: string }) {
    await callTool(this.parent ?? program, 'get_schedule_slice', { ...(options.start ? { startDate: options.start } : {}), ...(options.end ? { endDate: options.end } : {}) });
  });

schedule.command('shift')
  .requiredOption('--days <number>', 'signed number of project days')
  .option('--yes', 'confirm destructive operation')
  .option('--dry-run', 'preview the mutation without committing it')
  .action(async function (this: Command, options: { days: string; yes?: boolean; dryRun?: boolean }) {
    if (!options.yes && !options.dryRun) await confirmDestructive('Shift the entire project schedule?');
    await callTool(this.parent ?? program, 'shift_project', { deltaDays: Number.parseInt(options.days, 10) }, true, options.dryRun);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  printError(error, Boolean(program.opts().json));
  process.exitCode = exitCodeForError(error);
});
