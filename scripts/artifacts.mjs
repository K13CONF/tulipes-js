import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// Every published package, in release order; core first because its version names the tag.
const packages = ['core', 'spec', 'mongoose', 'bullmq', 'socket.io'];
const digest = file => 'sha512-' + createHash('sha512').update(readFileSync(file)).digest('base64');
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

function verify(dir, expectedCommit) {
  const manifest = readJson(join(dir, 'manifest.json'));
  if (expectedCommit && manifest.commit !== expectedCommit) throw new Error('Artifact commit does not match the release commit');
  if (manifest.packages?.length !== packages.length) throw new Error(`Expected ${packages.length} archives: ${packages.join(', ')}`);
  for (const name of packages) {
    const pkg = manifest.packages.find(pkg => pkg.name === '@tulipes/' + name);
    if (!pkg || basename(pkg.file) !== pkg.file) throw new Error('Invalid artifact manifest');
    const file = join(dir, pkg.file);
    if (digest(file) !== pkg.integrity) throw new Error(`Archive digest mismatch: ${pkg.name}`);
    const packed = JSON.parse(execFileSync('tar', ['-xOf', file, 'package/package.json'], { encoding: 'utf8' }));
    if (packed.name !== pkg.name || packed.version !== pkg.version || packed.license !== 'MIT') throw new Error('Packed identity/license mismatch');
    if (packed.exports['.'] !== './dist/index.js') throw new Error('Packed exports must point to compiled JavaScript');
    const listing = execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n');
    for (const required of ['package/LICENSE', 'package/dist/index.js']) {
      if (!listing.includes(required)) throw new Error(`Missing packed file: ${required}`);
    }
    if (name === 'core' && (packed.bin.tulipes !== './dist/cli/bin.js' || !listing.includes('package/dist/cli/bin.js'))) throw new Error('Missing compiled CLI');
    if (listing.some(path => /\/(?:node_modules|tests|\.envs)\//.test(path))) throw new Error('Unexpected private/test content in archive');
    // Core must not carry a driver — not as a dependency, and not through an
    // emitted declaration that a consumer's typecheck would need to resolve.
    const extracted = ['mongoose', 'bullmq', 'ioredis', 'socket.io'];
    if (name === 'core') {
      for (const dep of extracted) if (packed.dependencies?.[dep]) throw new Error(`Core must not depend on ${dep}`);
      const declarations = listing.filter(path => path.endsWith('.d.ts'));
      const leaking = execFileSync('tar', ['-xOf', file, ...declarations], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        .split('\n').filter(line => new RegExp(`from ["'](${extracted.join('|')})["']`).test(line));
      if (leaking.length) throw new Error('Core declarations import an extracted driver: ' + leaking.join(' | '));
    }
    if (name === 'mongoose' && (packed.dependencies?.mongoose || !packed.peerDependencies?.mongoose)) throw new Error('The provider must declare mongoose as a peer dependency only');
  }
  return manifest;
}

function prepare(dir) {
  mkdirSync(dir, { recursive: true });
  const manifest = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), packages: [] };
  for (const name of packages) {
    const source = readJson(`packages/${name}/package.json`);
    if (readFileSync(`packages/${name}/LICENSE`, 'utf8') !== readFileSync('LICENSE', 'utf8')) throw new Error('Package license differs from root LICENSE');
    const file = `${name}-${source.version}.tgz`;
    run('yarn', ['workspace', source.name, 'pack', '--out', join(dir, file)]);
    manifest.packages.push({ name: source.name, version: source.version, file, integrity: digest(join(dir, file)) });
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  verify(dir, manifest.commit);
}

export async function publicationPlan(packages, lookup) {
  const pending = [];
  for (const pkg of packages) {
    const existing = await lookup(pkg);
    if (!existing) pending.push(pkg);
    else if (existing.dist?.integrity !== pkg.integrity) throw new Error(`Published bytes differ for ${pkg.name}@${pkg.version}; use a new version`);
  }
  return pending;
}

async function publish(dir) {
  const manifest = verify(dir, process.env.GITHUB_SHA);
  const core = manifest.packages.find(pkg => pkg.name === '@tulipes/core');
  if (process.env.GITHUB_REF_TYPE !== 'tag' || process.env.GITHUB_REF_NAME !== 'v' + core.version) throw new Error('Publication requires a version-matching tag');
  const branch = process.env.RELEASE_BRANCH;
  if (!branch) throw new Error('RELEASE_BRANCH is required');
  run('git', ['merge-base', '--is-ancestor', manifest.commit, 'origin/' + branch]);
  // Resolve every immutable-version conflict before the first registry mutation.
  const pending = await publicationPlan(manifest.packages, async pkg => {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${pkg.version}`, { signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Registry query failed: ' + response.status);
    return response.json();
  });
  for (const pkg of pending) {
    run('npm', ['publish', join(dir, pkg.file), '--access', 'public', '--tag', pkg.version.includes('-') ? 'next' : 'latest']);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) try {
  const [action, target] = process.argv.slice(2);
  if (!target || !['prepare', 'verify', 'publish'].includes(action)) throw new Error('Usage: node scripts/artifacts.mjs prepare|verify|publish <directory>');
  const dir = resolve(target);
  if (action === 'prepare') prepare(dir);
  if (action === 'verify') { verify(dir, process.env.GITHUB_SHA); console.log('Artifact identity, contents and digests verified'); }
  if (action === 'publish') await publish(dir);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
