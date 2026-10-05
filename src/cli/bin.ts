#!/usr/bin/env node
import { run } from './main.js';

process.exitCode = run(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
  env: process.env,
});
