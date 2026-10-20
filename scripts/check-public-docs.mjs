import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredDocuments = [
  'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md',
  'ROADMAP.md', 'BRAND.md', 'THIRD_PARTY_NOTICES.md', 'PUBLICATION.md', 'docs/README.md', 'docs/demo-data.md',
  'docs/getting-started.md', 'docs/user-guide.md', 'docs/development.md',
  'docs/architecture.md', 'docs/configuration.md', 'docs/capabilities.md', 'docs/faq.md',
  'docs/deployment/vercel.md', 'docs/deployment/self-hosting.md', 'docs/deployment/database.md',
];
async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.relative(root, absolute));
  }
  return files;
}
const documents = [...new Set([...requiredDocuments, ...await markdownFiles(path.join(root, 'docs'))])];
const forbidden = [
  /cee\.people-lab\.ai/i,
  /cee\.neuravisor\.com/i,
  /walghamdi@elm\.sa/i,
  /departmenthub[_]production/i,
  /C:[\\/]Users[\\/]/i,
];
const failures = [];
let checkedLinks = 0;

async function exactCaseExists(absolute) {
  await access(absolute);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('link leaves repository');
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const entries = await readdir(current);
    if (!entries.includes(segment)) throw new Error('path case does not match (Linux portability)');
    current = path.join(current, segment);
  }
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

for (const filename of documents) {
  let text;
  try {
    text = await readFile(path.join(root, filename), 'utf8');
  } catch {
    failures.push({ file: filename, reason: 'required public document missing' });
    continue;
  }
  if (forbidden.some(pattern => pattern.test(text))) {
    failures.push({ file: filename, reason: 'organization-specific/private deployment reference in public guide' });
  }
  const tree = unified().use(remarkParse).parse(text);
  const definitions = new Map();
  walk(tree, node => { if (node.type === 'definition') definitions.set(node.identifier, node.url); });
  const links = [];
  walk(tree, node => {
    if (node.type === 'link' || node.type === 'image') links.push(node.url);
    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const target = definitions.get(node.identifier);
      if (target) links.push(target);
      else failures.push({ file: filename, reason: 'unresolved Markdown reference', reference: node.identifier });
    }
    if (node.type === 'html') {
      for (const match of node.value.matchAll(/(?:src|href)=["']([^"']+)["']/g)) links.push(match[1]);
    }
  });
  for (const link of links) {
    if (!link || /^(?:https?:|mailto:|data:|#)/i.test(link)) continue;
    const local = link.split(/[?#]/, 1)[0];
    if (!local) continue;
    checkedLinks += 1;
    try {
      await exactCaseExists(path.resolve(path.dirname(path.join(root, filename)), decodeURIComponent(local)));
    } catch (error) {
      failures.push({ file: filename, link, reason: error.code === 'ENOENT' ? 'relative link target missing' : error.message });
    }
  }
}
console.log(JSON.stringify({ documents: documents.length, checkedRelativeLinks: checkedLinks, failures }, null, 2));
if (failures.length) process.exitCode = 1;
