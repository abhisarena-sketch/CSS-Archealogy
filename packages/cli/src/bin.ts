#!/usr/bin/env node
import { run } from './cli.js';

const code = await run(process.argv.slice(2), {
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  cwd: process.cwd(),
  interactive: process.stderr.isTTY === true,
});
process.exitCode = code;
