import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';

const modulePath = path.resolve(process.cwd(), 'src/kernel/meshRoutingTable.ts');
const source = fs.readFileSync(modulePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const tempFile = path.resolve(process.cwd(), '.tmp-mesh-routing-table.mjs');
fs.writeFileSync(tempFile, transpiled);

const mod = await import(pathToFileURL(tempFile).href);
const { MeshRoutingTable } = mod;

test('prefers lower-cost routes and remembers direct neighbors', () => {
  const table = new MeshRoutingTable();

  table.observeDirectLink('peer-a', {
    via: 'bluetooth',
    quality: 0.92,
    cost: 4,
    hops: 1,
    path: ['peer-a'],
    lastSeen: 1000,
  });

  table.observeDirectLink('peer-b', {
    via: 'wifi',
    quality: 0.78,
    cost: 7,
    hops: 1,
    path: ['peer-b'],
    lastSeen: 1000,
  });

  table.observeRoute('peer-c', 'peer-a', {
    via: 'peer-a',
    quality: 0.9,
    cost: 6,
    hops: 2,
    path: ['peer-a', 'peer-c'],
    lastSeen: 1000,
  });

  table.observeRoute('peer-c', 'peer-b', {
    via: 'peer-b',
    quality: 0.8,
    cost: 9,
    hops: 3,
    path: ['peer-b', 'peer-c'],
    lastSeen: 1000,
  });

  const best = table.getBestRoute('peer-c');
  assert.ok(best);
  assert.equal(best.nextHop, 'peer-a');
  assert.equal(best.cost, 6);
  assert.equal(best.hops, 2);
});

test('selects the best gateway route', () => {
  const table = new MeshRoutingTable();

  table.observeRoute('gateway-1', 'peer-a', {
    via: 'peer-a',
    quality: 0.95,
    cost: 3,
    hops: 1,
    path: ['peer-a', 'gateway-1'],
    lastSeen: 1000,
    gateway: true,
  });

  table.observeRoute('gateway-2', 'peer-b', {
    via: 'peer-b',
    quality: 0.88,
    cost: 5,
    hops: 2,
    path: ['peer-b', 'gateway-2'],
    lastSeen: 1000,
    gateway: true,
  });

  const best = table.getBestGateway();
  assert.ok(best);
  assert.equal(best.targetId, 'gateway-1');
  assert.equal(best.nextHop, 'peer-a');
});
