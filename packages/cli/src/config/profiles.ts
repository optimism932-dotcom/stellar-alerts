import { chmodSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  createProfileStore,
  createProfile,
  getConfigDir,
  listProfiles,
  setActiveProfile,
  setSecret,
  updateProfile,
} from '../lib/profile-store.js';
import type { ProfileConfig } from '../lib/profile-types.js';

export type InitNetwork = 'mainnet' | 'testnet' | 'futurenet';

export interface InitProfileInput {
  name: string;
  apiUrl: string;
  network: InitNetwork;
  apiKey: string;
  logLevel?: ProfileConfig['logLevel'];
}

export function checkProfilesFilePermissions(configDir: string = getConfigDir()): {
  ok: boolean;
  message: string;
} {
  const profilesPath = join(configDir, 'profiles.json');
  if (!existsSync(profilesPath)) {
    return { ok: true, message: 'profiles.json not present (no profiles configured)' };
  }
  const mode = statSync(profilesPath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    return {
      ok: false,
      message: `profiles.json permissions are ${mode.toString(8)} (expected 600)`,
    };
  }
  return { ok: true, message: `profiles.json permissions are ${mode.toString(8)}` };
}

export function normalizeApiUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('API URL is required');

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('API URL must be a valid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('API URL must use http or https');
  }

  return parsed.toString().replace(/\/+$/, '');
}

export function validateNetwork(value: string): InitNetwork {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'mainnet' || normalized === 'testnet' || normalized === 'futurenet') {
    return normalized;
  }
  throw new Error('Network must be mainnet, testnet, or futurenet');
}

export async function validateApiKey(
  apiUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!apiKey.trim()) throw new Error('API key is required');

  let response: Response;
  try {
    response = await fetchImpl(`${normalizeApiUrl(apiUrl)}/wallets`, {
      headers: { 'x-api-key': apiKey },
    });
  } catch (error) {
    throw new Error(`Could not reach API: ${(error as Error).message}`);
  }

  if (!response.ok) {
    throw new Error(`API key validation failed (${response.status})`);
  }
}

export async function saveInitProfile(
  input: InitProfileInput,
  vaultPassword: string,
  configDir: string = getConfigDir(),
): Promise<ProfileConfig> {
  if (!vaultPassword) throw new Error('Vault password is required');

  const store = createProfileStore(configDir);
  const apiUrl = normalizeApiUrl(input.apiUrl);
  const network = validateNetwork(input.network);
  const existing = listProfiles(store).find((profile) => profile.name === input.name);

  const profile = existing
    ? updateProfile(store, input.name, { apiUrl, network, logLevel: input.logLevel ?? 'info' })
    : createProfile(store, input.name, {
        apiUrl,
        network,
        logLevel: input.logLevel ?? 'info',
      });

  await setSecret(store, input.name, 'apiKey', input.apiKey, vaultPassword);
  setActiveProfile(store, input.name);

  const profilesPath = join(configDir, 'profiles.json');
  if (existsSync(profilesPath)) chmodSync(profilesPath, 0o600);
  const vaultPath = join(configDir, 'vault.enc');
  if (existsSync(vaultPath)) chmodSync(vaultPath, 0o600);

  return profile;
}
