import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMeshVpnPreview, resolveMeshVpnRole } from './meshVpnPolicy.ts';

test('falls back from gateway to client when the device is offline', () => {
  assert.equal(resolveMeshVpnRole('gateway', false), 'client');
});

test('describes the preview for a gateway role', () => {
  const note = describeMeshVpnPreview('gateway', true);
  assert.match(note, /gateway/i);
  assert.match(note, /preview/i);
});
