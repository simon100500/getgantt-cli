// FILE: src/config.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Store GetGantt CLI profiles and the selected project on the local machine.
//   SCOPE: Resolve config paths, load/save profiles, and select the active profile.
//   DEPENDS: Node fs/path/os
//   LINKS: M-CLI-CONFIG, M-CLI-AUTH
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type CliProfile = {
  baseUrl: string;
  token: string;
  projectId?: string;
};

export type CliConfig = {
  currentProfile: string;
  profiles: Record<string, CliProfile>;
};

function configDirectory(): string {
  if (process.env.APPDATA) return join(process.env.APPDATA, 'GetGantt');
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'getgantt');
}

export function configPath(): string {
  return join(configDirectory(), 'config.json');
}

const emptyConfig = (): CliConfig => ({ currentProfile: 'default', profiles: {} });

export async function loadConfig(): Promise<CliConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return {
      currentProfile: typeof parsed.currentProfile === 'string' ? parsed.currentProfile : 'default',
      profiles: parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles as Record<string, CliProfile> : {},
    };
  } catch (error: any) {
    if (error?.code === 'ENOENT') return emptyConfig();
    throw new Error(`Cannot read ${configPath()}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function saveConfig(config: CliConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

export function envToken(): string | undefined {
  const value = process.env.GETGANTT_TOKEN?.trim();
  return value || undefined;
}

export async function resolveProfile(name?: string): Promise<{ config: CliConfig; name: string; profile: CliProfile }> {
  const config = await loadConfig();
  const profileName = name ?? config.currentProfile;
  const profile = config.profiles[profileName];
  if (!profile) throw new Error(`Profile "${profileName}" is not configured. Run: gantt auth login`);
  return { config, name: profileName, profile };
}

