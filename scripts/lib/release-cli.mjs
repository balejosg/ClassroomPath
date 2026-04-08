export function parseCommandLine(argv, { valueFlags = [] } = {}) {
  const [command, ...rest] = argv;
  const options = {};
  const flagsWithValues = new Set(valueFlags);

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!flagsWithValues.has(token)) {
      throw new Error(`Unknown argument: ${token}`);
    }

    options[token.slice(2)] = rest[index + 1];
    index += 1;
  }

  return { command, options };
}

export function requireCliOption(options, key, message) {
  const value = options?.[key];
  if (value) {
    return value;
  }

  throw new Error(message);
}

export function runCli(main, { argv = process.argv.slice(2) } = {}) {
  try {
    const exitCode = main(argv);
    if (typeof exitCode === 'number' && exitCode !== 0) {
      process.exit(exitCode);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
