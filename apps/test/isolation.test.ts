import { describe, expect, it } from 'vitest';
import { validateTestTarget, validateFixturePath } from './support/environment';
describe('isolation', () => {
  it('rejects_production_bindings', () => {
    expect(() => validateTestTarget({name: 'production', remote: true, persistPath: '/tmp/db'})).toThrow();
    expect(() => validateTestTarget({name: 'iso-test', remote: false, persistPath: '../../output/test/state/db'})).not.toThrow();
  });
  it('rejects_operational_source_paths', () => {
    expect(() => validateFixturePath('../../docs/manual/a.md')).toThrow();
    expect(() => validateFixturePath('../seed/inputs/a.json')).toThrow();
    expect(() => validateFixturePath('fixtures/records/example.md')).not.toThrow();
    expect(() => validateFixturePath('fixtures/../../../../docs/a.md')).toThrow();
  });
});
