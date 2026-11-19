import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findDuplicateIds, normalizeProtocolVersion } from '../dist/config.js';

describe('config', () => {
  it('normalises numeric and string protocol versions', () => {
    assert.equal(normalizeProtocolVersion(3.4), '3.4');
    assert.equal(normalizeProtocolVersion(3.3), '3.3');
    assert.equal(normalizeProtocolVersion('3.5'), '3.5');
    assert.equal(normalizeProtocolVersion(' 3.1 '), '3.1');
  });

  it('rejects unknown protocol versions', () => {
    assert.equal(normalizeProtocolVersion(undefined), undefined);
    assert.equal(normalizeProtocolVersion(''), undefined);
    assert.equal(normalizeProtocolVersion('4.0'), undefined);
    assert.equal(normalizeProtocolVersion(34), undefined);
  });

  it('finds duplicate device ids', () => {
    assert.deepEqual(findDuplicateIds(['a', 'b', 'a', 'c', 'b', 'a']), ['a', 'b']);
    assert.deepEqual(findDuplicateIds(['a', 'b', undefined, '']), []);
  });
});
