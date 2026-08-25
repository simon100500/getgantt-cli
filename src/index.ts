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
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { GetGanttApiClient } from './api-client.js';
import { envToken, loadConfig, resolveProfile, saveConfig, type CliProfile } from './config.js';
import { print, printError } from './output.js';

function isJson(command: Command): boolean {
  return Boolean(command.optsWithGlobals().json);
}

function baseUrl(command: Command): string {
  return String(command.optsWithGlobals().server ?? 'https://ai.getgantt.ru');
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
  return new GetGanttApiClient(profile.baseUrl || baseUrl(command), tokenOverride ?? envToken() ?? profile.token);
}

async function resolveClient(command: Command): Promise<{ client: GetGanttApiClient; config: Awaited<ReturnType<typeof loadConfig>>; profileName: string; profile: CliProfile }> {
  const resolved = await resolveProfile(command.optsWithGlobals().profile);
  return { config: resolved.config, profileName: resolved.name, profile: resolved.profile, client: makeClient(resolved.profile, command) };
}

const program = new Command()
  .name('gantt')
  .description('GetGantt command-line client')
  .option('--json', 'print machine-readable JSON')
  .option('--server <url>', 'GetGantt server URL', 'https://ai.getgantt.ru')
  .option('--profile <name>', 'profile name')
  .option('--project <id>', 'project ID or exact name');

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
    const projectsResult = await resolved.client.projects();
    const explicit = command.optsWithGlobals().project as string | undefined;
    const selected = explicit
      ? projectsResult.items.filter((project) => project.id === explicit || project.name === explicit)
      : resolved.profile.projectId
        ? projectsResult.items.filter((project) => project.id === resolved.profile.projectId)
        : projectsResult.items.length === 1 ? [projectsResult.items[0]!] : [];
    if (selected.length !== 1) throw new Error('A single project is required. Use --project or `gantt projects use <id-or-exact-name>`.');
    print({ project: selected[0] }, isJson(command), `${selected[0]!.name} (${selected[0]!.id})`);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  printError(error, Boolean(program.opts().json));
  process.exitCode = 1;
});
