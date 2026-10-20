import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] || path.join(root, '..', 'WorkOps-public'));
const relativeDestination = path.relative(root, destination);
if (!relativeDestination.startsWith('..') && !path.isAbsolute(relativeDestination)) throw new Error('Export must be outside the source checkout.');
try { await access(destination); throw new Error('Export destination already exists; choose a new directory.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

const rootFiles = new Set([
  'README.md', 'LICENSE', 'BRAND.md', 'THIRD_PARTY_NOTICES.md', 'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SUPPORT.md', 'ROADMAP.md', 'PUBLICATION.md',
  'package.json', 'package-lock.json', 'next.config.mjs', 'postcss.config.mjs',
  'tailwind.config.ts', 'tsconfig.json', 'vitest.config.ts', 'playwright.config.ts',
  'playwright.chat.config.ts', 'vercel.json', 'Dockerfile', 'compose.yaml',
  '.dockerignore', '.gitignore', '.eslintrc.json', '.env.example', 'components.json',
]);
const publicDocs = new Set([
  'README.md', 'getting-started.md', 'user-guide.md', 'development.md', 'architecture.md',
  'configuration.md', 'capabilities.md', 'faq.md', 'demo-data.md',
  'deployment/vercel.md', 'deployment/self-hosting.md', 'deployment/database.md',
  'security/workspace-ownership.csv.md',
]);
const privateScripts = new Set([
  'scripts/apply-prod-migration.js', 'scripts/neon-sql.js', 'scripts/safe-migrate.sh',
  'scripts/set-aliases.js', 'scripts/seed-submitted-reports.js',
]);
function eligible(name) {
  if (name.split('/').some(segment => segment.startsWith('.hermes-tmp') || segment === '.clerk')) return false;
  if (name.startsWith('public/fonts/thmanyah/')) return false;
  if (name.startsWith('src/') || name.startsWith('public/') || name.startsWith('prisma/') || name.startsWith('e2e/')) return true;
  if (name.startsWith('scripts/')) return !privateScripts.has(name);
  if (name.startsWith('docs/images/')) return true;
  if (name.startsWith('docs/')) return publicDocs.has(name.slice(5));
  if (name.startsWith('.github/ISSUE_TEMPLATE/') || ['.github/PULL_REQUEST_TEMPLATE.md', '.github/CODEOWNERS', '.github/dependabot.yml', '.github/workflows/ci.yml', '.github/workflows/sabah-jobs.yml', '.github/workflows/sabah-monitors.yml'].includes(name)) return true;
  return rootFiles.has(name);
}

const candidates = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).split('\0').filter(Boolean))].filter(eligible).sort();
const selected = [];
const privateReferences = [/@elm\.sa/i, /cee\.people-lab\.ai/i, /cee\.neuravisor\.com/i, /departmenthub[_]production/i, /C:[\\/]Users[\\/]/i];
for (const name of candidates) {
  const source = path.resolve(root, name);
  if (path.relative(root, source).startsWith('..')) throw new Error('Source escapes checkout.');
  let stat;
  try { stat = await lstat(source); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Unsupported export entry: ${name}`);
  if (/\.(?:md|mjs|cjs|js|ts|tsx|json|ya?ml|prisma|sql|svg|html|css|txt|example)$/i.test(name)) {
    const text = await readFile(source, 'utf8');
    if (privateReferences.some(pattern => pattern.test(text))) throw new Error(`Private reference must be reviewed before export: ${name}`);
  }
  selected.push(name);
}
for (const required of ['LICENSE', 'README.md', 'package-lock.json', 'Dockerfile', 'prisma/schema.prisma', 'docs/deployment/vercel.md', 'public/images/workops-dashboard.png']) {
  if (!selected.includes(required)) throw new Error(`Required product file missing: ${required}`);
}
await mkdir(destination);
const files = [];
for (const name of selected) {
  const target = path.join(destination, name);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(root, name), target);
  files.push({ path: name, sha256: createHash('sha256').update(await readFile(target)).digest('hex') });
}
// Publish a clean, credential-free npm policy rather than copying local registry configuration.
await writeFile(path.join(destination, '.npmrc'), 'legacy-peer-deps=true\n', 'utf8');
const copiedFileCount = files.length;
files.push({ path: '.npmrc', sha256: createHash('sha256').update(await readFile(path.join(destination, '.npmrc'))).digest('hex') });
await writeFile(path.join(destination, 'PUBLIC_EXPORT_MANIFEST.json'), JSON.stringify({ format: 1, historyIncluded: false, fileCount: files.length, files }, null, 2) + '\n');
console.log(JSON.stringify({ destination, copiedFiles: copiedFileCount, historyIncluded: false, note: 'Run the documented quality and secret scans on this exported tree before publication.' }, null, 2));
