import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { getConfigDir } from '../lib/profile-store.js';

export const MIN_NODE_MAJOR = 20;

export interface DoctorCheckResult {
  name: string;
  passed: boolean;
  message: string;
  hint?: string;
}

export interface DoctorOptions {
  apiUrl: string;
  horizonUrl?: string;
  configDir?: string;
  nodeVersion?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function checkNodeVersion(nodeVersion: string = process.versions.node): DoctorCheckResult {
  const major = Number.parseInt(nodeVersion.split('.')[0] ?? '', 10);
  const passed = Number.isFinite(major) && major >= MIN_NODE_MAJOR;
  return {
    name: 'Node.js version',
    passed,
    message: passed
      ? `Node.js v${nodeVersion} (>= ${MIN_NODE_MAJOR})`
      : `Node.js v${nodeVersion} is below the minimum required version ${MIN_NODE_MAJOR}`,
    hint: passed ? undefined : `Install Node.js ${MIN_NODE_MAJOR} or newer (https://nodejs.org)`,
  };
}

export function checkProfileConfig(configDir: string = getConfigDir()): DoctorCheckResult {
  const profilesPath = join(configDir, 'profiles.json');
  if (!existsSync(profilesPath)) {
    return {
      name: 'Profile configuration',
      passed: false,
      message: `Profile file not found at ${profilesPath}`,
      hint: 'Run `stellar-alerts-cli init` to create a profile',
    };
  }

  let raw: string;
  try {
    raw = readFileSync(profilesPath, 'utf8');
  } catch (error) {
    return {
      name: 'Profile configuration',
      passed: false,
      message: `Could not read ${profilesPath}: ${(error as Error).message}`,
      hint: 'Check file permissions on the profile file',
    };
  }

  try {
    JSON.parse(raw);
  } catch {
    return {
      name: 'Profile configuration',
      passed: false,
      message: `Profile file ${profilesPath} contains invalid JSON`,
      hint: 'Fix or delete the profile file and re-run `stellar-alerts-cli init`',
    };
  }

  const issues: string[] = [];
  if (process.platform !== 'win32') {
    const mode = statSync(profilesPath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      issues.push(`permissions ${mode.toString(8)} are too open`);
    }
  }

  if (issues.length > 0) {
    return {
      name: 'Profile configuration',
      passed: false,
      message: `Profile file ${profilesPath}: ${issues.join('; ')}`,
      hint: `Run \`chmod 600 ${profilesPath}\``,
    };
  }

  return {
    name: 'Profile configuration',
    passed: true,
    message: `Profile file is valid JSON at ${profilesPath}`,
  };
}

async function pingUrl(
  label: string,
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<DoctorCheckResult> {
  const target = url.replace(/\/+$/, '');
  try {
    const response = await fetchImpl(target, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const passed = response.status < 500;
    return {
      name: label,
      passed,
      message: `${target} responded with HTTP ${response.status}`,
      hint: passed ? undefined : `Verify the ${label} service is running and healthy`,
    };
  } catch (error) {
    return {
      name: label,
      passed: false,
      message: `${target} is unreachable: ${(error as Error).message}`,
      hint: `Check that ${target} is correct and the service is running`,
    };
  }
}

export async function runDoctorChecks(options: DoctorOptions): Promise<DoctorCheckResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const horizonUrl = options.horizonUrl ?? process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';

  const results: DoctorCheckResult[] = [];
  results.push(checkNodeVersion(options.nodeVersion));
  results.push(checkProfileConfig(options.configDir));
  results.push(await pingUrl('Stellar Alerts API', `${options.apiUrl}/health`, fetchImpl, timeoutMs));
  results.push(await pingUrl('Horizon RPC', horizonUrl, fetchImpl, timeoutMs));
  return results;
}

export function formatDoctorReport(results: DoctorCheckResult[]): string {
  const lines: string[] = [chalk.bold('stellar-alerts doctor'), ''];
  for (const result of results) {
    const icon = result.passed ? chalk.green('✔') : chalk.red('✖');
    lines.push(`${icon} ${result.name}: ${result.message}`);
    if (!result.passed && result.hint) {
      lines.push(`    ${chalk.yellow('hint:')} ${result.hint}`);
    }
  }
  const failed = results.filter((r) => !r.passed).length;
  lines.push('');
  lines.push(
    failed === 0
      ? chalk.green('All checks passed.')
      : chalk.red(`${failed} check(s) failed.`),
  );
  return lines.join('\n');
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose local environment (Node.js, profile config, API and Horizon connectivity)')
    .action(async () => {
      const apiUrl = program.opts().apiUrl as string;
      const results = await runDoctorChecks({ apiUrl });
      console.log(formatDoctorReport(results));
      const allPassed = results.every((r) => r.passed);
      process.exit(allPassed ? 0 : 1);
    });
}
