export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export function stripPnpmSeparator(argv: readonly string[]): readonly string[] {
  return argv[0] === '--' ? argv.slice(1) : argv;
}

export function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) {
      throw new CliUsageError(`unexpected argument: ${token ?? ''}`);
    }
    const key = token.slice(2);
    if (key.length === 0 || flags.has(key))
      throw new CliUsageError(`invalid or duplicate flag: ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--'))
      throw new CliUsageError(`missing value for ${token}`);
    flags.set(key, value);
    index += 1;
  }
  return flags;
}

export function requiredFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.length === 0) throw new CliUsageError(`missing --${name}`);
  return value;
}

export function optionalNonNegativeInteger(
  flags: Map<string, string>,
  name: string,
): number | undefined {
  const value = flags.get(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CliUsageError(`--${name} must be a non-negative safe integer`);
  }
  return parsed;
}

export function failCli(error: unknown): never {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'CLI_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${code}: ${message}`);
  process.exit(1);
  throw new Error('process.exit returned unexpectedly');
}
