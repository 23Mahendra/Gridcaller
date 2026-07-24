import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';

const modulePath = path.resolve(process.cwd(), 'src/kernel/serverlessMesh.ts');
const source = fs.readFileSync(modulePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const tempFile = path.resolve(process.cwd(), '.tmp-serverless-mesh.mjs');
fs.writeFileSync(tempFile, transpiled);

const mod = await import(pathToFileURL(tempFile).href);
const { encryptText, decryptText } = mod;

test('encrypts and decrypts mesh payloads locally', () => {
  const secret = 'mesh-secret';
  const cipher = encryptText('hello mesh', secret);
  assert.notEqual(cipher, 'hello mesh');
  assert.equal(decryptText(cipher, secret), 'hello mesh');
});
