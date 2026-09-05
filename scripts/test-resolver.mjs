// Resolver hook for `node --test`: makes Node resolve imports the way Metro and
// TypeScript do, so tests can run the app's real source untouched.
//
// Three gaps to bridge:
//   1. the project's "@/*" → "src/*" path alias;
//   2. extensionless and directory imports ("./migrations" → "./migrations/index.ts"),
//      which bundlers allow but Node's ESM resolver rejects;
//   3. modules that only exist inside a React Native runtime ("react",
//      "react-native") plus the app's composition roots ("@/services", "@/data"),
//      which are mapped to the doubles in tests/helpers so hook logic can be
//      driven off-device. Only the exact barrel specifiers are substituted —
//      deep imports such as "@/services/bookService" still resolve to real
//      source, which is what the service-level tests exercise.
import { statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(projectRoot, 'src');
const helpersRoot = path.join(projectRoot, 'tests', 'helpers');

const SUBSTITUTES = new Map([
  ['react', path.join(helpersRoot, 'hookHarness.ts')],
  ['react-native', path.join(helpersRoot, 'reactNativeStub.ts')],
  ['@/services', path.join(helpersRoot, 'servicesStub.ts')],
  ['@/data', path.join(helpersRoot, 'dataStub.ts')],
]);

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
    // Runtime-only modules and composition roots → their test doubles.
    const substitute = SUBSTITUTES.get(specifier);
    if (substitute) {
      return { url: pathToFileURL(substitute).href, shortCircuit: true };
    }

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
