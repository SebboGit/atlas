// Guard against MapLibre's silent blank-map failure mode.
//
// The worker is an ES module that imports a sibling chunk by relative path.
// Stage the worker without that sibling and the worker throws on its first
// import: the map mounts, the canvas stays empty, and nothing reaches the
// console — no test that only asserts "the map component rendered" catches it.
// So assert the staging list actually covers what the installed worker asks
// for, reading the real file out of node_modules.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAPLIBRE_WORKER_ENTRY,
  maplibreDistDir,
  maplibreVersion,
  relativeModuleSpecifiers,
  stagedWorkerFiles,
} from './maplibre-worker-files';

describe('maplibre worker staging', () => {
  it('stages the worker entry first — setWorkerUrl points at it', () => {
    expect(stagedWorkerFiles()[0]).toBe(MAPLIBRE_WORKER_ENTRY);
  });

  it('stages every relative import the installed worker makes', () => {
    const dist = maplibreDistDir();
    const worker = readFileSync(path.join(dist, MAPLIBRE_WORKER_ENTRY), 'utf8');
    const imports = relativeModuleSpecifiers(worker).map((s) => s.replace(/^\.\//, ''));

    // A build that imports nothing means the extractor stopped matching the
    // bundle's syntax — exactly the drift this test exists to catch.
    expect(imports.length).toBeGreaterThan(0);

    const staged = stagedWorkerFiles(dist);
    for (const specifier of imports) {
      expect(staged).toContain(specifier);
    }
  });

  it('reads a version for the staging path', () => {
    expect(maplibreVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('finds relative specifiers in minified and spaced syntax alike', () => {
    const source = [
      'import{a}from"./one.mjs";',
      "import './two.mjs';",
      'export * from "./three.mjs";',
      'await import("./four.mjs");',
      'import x from "maplibre-gl";',
      '//# sourceMappingURL=five.mjs.map',
    ].join('\n');

    expect(relativeModuleSpecifiers(source).sort()).toEqual([
      './four.mjs',
      './one.mjs',
      './three.mjs',
      './two.mjs',
    ]);
  });
});
