#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = resolve(rootDir, 'packages/omnibuf-node/dist/bin/conformance-es.js');
// Keep the runner and testdata/conformance_corpus.json on the same upstream revision.
const upstreamRevision = 'v0.1.0';
const runnerDir = resolve(rootDir, 'bin/conformance', upstreamRevision);
const localRunner = resolve(runnerDir, 'conformance-runner');

function resolveRunnerBinary() {
  if (process.env.CONFORMANCE_RUNNER && existsSync(process.env.CONFORMANCE_RUNNER)) {
    return process.env.CONFORMANCE_RUNNER;
  }
  if (existsSync(localRunner)) {
    return localRunner;
  }
  mkdirSync(runnerDir, { recursive: true });
  execFileSync(
    'go',
    ['install', `github.com/omnibuf/omnibuf-go/cmd/conformance-runner@${upstreamRevision}`],
    {
      cwd: rootDir,
      env: { ...process.env, GOBIN: runnerDir },
      stdio: 'inherit',
    },
  );
  return localRunner;
}

const runner = resolveRunnerBinary();
const runnerFlags = process.argv.slice(2).filter((arg) => arg !== '--');
execFileSync(runner, [...runnerFlags, process.execPath, adapterPath], {
  cwd: rootDir,
  stdio: 'inherit',
});
