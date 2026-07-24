import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMeshVpnRole } from '../src/kernel/meshVpnPolicy.js';

test('prefers gateway mode when the device is online and the role is enabled', () => {
  assert.equal(resolveMeshVpnRole('gateway', true), 'gateway');
});

test('falls back to client mode when the device is offline but the role is enabled', () => {
  assert.equal(resolveMeshVpnRole('gateway', false), 'client');
});

test('disables the VPN bridge when the mode is off', () => {
  assert.equal(resolveMeshVpnRole('disabled', true), 'disabled');
});
