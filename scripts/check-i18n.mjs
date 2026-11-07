import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
const errors = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist', '.wxt', '.output'].includes(item.name)) continue;
    const path = join(dir, item.name);
    if (item.isDirectory()) await walk(path);
    else if (path.endsWith('.tsx')) {
      const source = ts.createSourceFile(
        path,
        await readFile(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function visit(node) {
        const visibleText = ts.isJsxText(node) && node.text.trim();
        const literalAttribute =
          ts.isJsxAttribute(node) &&
          ['title', 'placeholder', 'aria-label', 'alt'].includes(node.name.getText(source)) &&
          node.initializer &&
          ts.isStringLiteral(node.initializer) &&
          node.initializer.text.trim();
        if ((visibleText && /[a-zA-Z\u4e00-\u9fff]/.test(visibleText)) || literalAttribute)
          errors.push(`${path}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
await walk('apps');
await walk('packages/ui');
if (errors.length) {
  console.error('Untranslated JSX text:', errors.join('\n'));
  process.exit(1);
}
