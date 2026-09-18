// Work out which files MapLibre's tile-decoder worker needs on disk.
//
// MapLibre GL JS v6 ships the worker as an ES module that imports a shared
// chunk by relative path, so staging the worker alone gets you a worker that
// throws on its first import — the failure mode is a blank map canvas with
// nothing in the console. Rather than hard-coding the sibling's name, we read
// the worker's own import specifiers and follow them. A future release that
// splits out another chunk is then staged automatically instead of silently
// missed.
//
// The walk reads import and export specifiers only. An asset referenced as
// `new URL('./x', import.meta.url)` would not be seen — MapLibre's worker uses
// none today, and one appearing is the kind of change a major bump gets read
// for anyway.
//
// Source maps are deliberately not staged. The browser only asks for a
// `.mjs.map` when devtools is open, and a 404 there costs nothing but a
// console line; shipping half a megabyte of map per file to every visitor
// costs rather more.

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The worker entry point MapLibre expects `setWorkerUrl` to point at. */
export const MAPLIBRE_WORKER_ENTRY = 'maplibre-gl-worker.mjs';

const require = createRequire(import.meta.url);

function maplibrePackageJsonPath(): string {
  return require.resolve('maplibre-gl/package.json');
}

/** Absolute path of the installed maplibre-gl's `dist/` directory. */
export function maplibreDistDir(): string {
  return path.join(path.dirname(maplibrePackageJsonPath()), 'dist');
}

/**
 * Version of the installed maplibre-gl. The staged files live under this,
 * and the browser builds the same path from `getVersion()` at runtime, so
 * the two cannot drift.
 */
export function maplibreVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(maplibrePackageJsonPath(), 'utf8'));
  const version =
    typeof pkg === 'object' && pkg !== null ? (pkg as { version?: unknown }).version : undefined;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('maplibre-gl/package.json has no usable "version" field.');
  }
  return version;
}

/**
 * Relative module specifiers (`./something.mjs`) a bundle references —
 * static imports, side-effect imports, re-exports and dynamic `import()`
 * alike. Minified output has no whitespace, so the pattern tolerates both.
 */
export function relativeModuleSpecifiers(source: string): string[] {
  const pattern = /\b(?:from|import)\s*\(?\s*['"](\.\/[^'"]+)['"]/g;
  const found = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier) found.add(specifier);
  }
  return [...found];
}

/**
 * Every file that has to land in the staging directory, worker entry first.
 * Walks the import graph from the entry, following relative specifiers until
 * nothing new turns up.
 *
 * Throws on a specifier that doesn't resolve to a file, or on one that points
 * outside `dist/`. A loud failure at build time is the whole point: the
 * alternative is a map that mounts and then renders nothing.
 */
export function stagedWorkerFiles(distDir: string = maplibreDistDir()): string[] {
  const staged: string[] = [];
  const queue = [MAPLIBRE_WORKER_ENTRY];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);

    const filePath = path.join(distDir, name);
    if (path.relative(distDir, filePath).startsWith('..')) {
      throw new Error(`MapLibre worker references a file outside dist/: ${name}`);
    }
    if (!existsSync(filePath)) {
      throw new Error(
        `MapLibre worker references ${name}, which is missing from ${distDir}. ` +
          'The installed maplibre-gl looks broken or its dist layout changed.',
      );
    }

    staged.push(name);
    for (const specifier of relativeModuleSpecifiers(readFileSync(filePath, 'utf8'))) {
      queue.push(specifier.replace(/^\.\//, ''));
    }
  }

  return staged;
}
