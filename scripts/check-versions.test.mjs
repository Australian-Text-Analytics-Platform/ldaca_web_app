import assert from 'node:assert/strict';
import test from 'node:test';

import { SEMVER, VERSION_TARGETS, versionFromReleaseTag } from './version-targets.mjs';

test('one registry includes the Tauri manifest and lock entry', () => {
    assert.deepEqual(
        VERSION_TARGETS.map(({ path }) => path),
        [
            'pyproject.toml',
            'backend/pyproject.toml',
            'frontend/package.json',
            'frontend/src-tauri/Cargo.toml',
            'frontend/src-tauri/Cargo.lock',
            'frontend/src-tauri/tauri.conf.json',
        ],
    );
});

test('each target extracts its replacement from a representative fixture', () => {
    const fixtures = [
        'version = "0.5.0"',
        'version = "0.5.0"',
        '{ "version": "0.5.0" }',
        '[package]\nname = "ldaca-wordflow"\nversion = "0.5.0"',
        '[[package]]\nname = "ldaca-wordflow"\nversion = "0.5.0"',
        '{ "version": "0.5.0" }',
    ];
    VERSION_TARGETS.forEach((target, index) => {
        const replaced = target.replace(fixtures[index], '0.6.0');
        assert.equal(target.extract(replaced), '0.6.0');
    });
});

test('release tags must be exact v-prefixed semver', () => {
    assert.equal(versionFromReleaseTag('v0.6.0'), '0.6.0');
    assert.equal(versionFromReleaseTag(''), null);
    assert.throws(() => versionFromReleaseTag('release-0.6.0'));
    assert.equal(SEMVER.test('0.6.0-rc.1'), true);
});
