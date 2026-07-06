const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUTPUT = path.join(ROOT, 'snapshot.md');
const EXCLUDE_DIRS = new Set(['.git', 'obsidian', 'node_modules']);
const EXCLUDE_FILES = new Set(['snapshot.md', 'LICENSE']);

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const textExts = new Set(['.js', '.json', '.html', '.css', '.md', '.yml', '.yaml', '.txt', '.gitignore']);
  if (textExts.has(ext)) return true;
  if (!ext) return true;
  return false;
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(ROOT, fullPath);
    const topLevel = relative.split(path.sep)[0];

    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(topLevel)) {
        files.push(...walk(fullPath));
      }
    } else if (entry.isFile()) {
      if (!EXCLUDE_FILES.has(relative) && !EXCLUDE_FILES.has(entry.name) && isTextFile(fullPath)) {
        files.push(relative);
      }
    }
  }

  return files;
}

const files = walk(ROOT).sort();

const parts = files.map((file) => {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf-8');
  return `# ${file}\n\n${content}`;
});

fs.writeFileSync(OUTPUT, parts.join('\n\n') + '\n', 'utf-8');
console.log(`snapshot.md generated with ${files.length} files`);
