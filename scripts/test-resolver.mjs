// Resolver hook for `node --test`: makes Node resolve imports the way Metro and
// TypeScript do, so tests can run the app's real source untouched.
//
// Two gaps to bridge:
//   1. the project's "@/*" → "src/*" path alias;
//   2. extensionless and directory imports ("./migrations" → "./migrations/index.ts"),
//      which bundlers allow but Node's ESM resolver rejects.
//
// Node 24 runs TypeScript natively (type-stripping), so no transpiler is needed.
import { statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(projectRoot, 'src');

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Tries the extensions and index files a bundler would try. */
function resolveFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
  ];

  for (const candidate of candidates) {
    if (isFile(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // "@/foo" → "<root>/src/foo"
    if (specifier.startsWith('@/')) {
      const url = resolveFile(path.join(srcRoot, specifier.slice(2)));
      if (url) return { url, shortCircuit: true };
    }

    // "./foo" / "../foo" — fill in the extension or index file.
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const url = resolveFile(path.resolve(parentDir, specifier));
      if (url) return { url, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});
