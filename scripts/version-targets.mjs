/** Shared registry for every independently stamped release version. */
export const VERSION_TARGETS = [
    tomlTarget('workspace pyproject.toml', 'pyproject.toml'),
    tomlTarget('backend/pyproject.toml', 'backend/pyproject.toml'),
    jsonTarget('frontend/package.json', 'frontend/package.json'),
    {
        label: 'frontend/src-tauri/Cargo.toml',
        path: 'frontend/src-tauri/Cargo.toml',
        extract: (source) =>
            source.match(/\[package\][\s\S]*?\n\s*version\s*=\s*"([^"]+)"/)?.[1],
        replace: (source, version) =>
            source.replace(
                /(\[package\][\s\S]*?\n\s*version\s*=\s*)"[^"]+"/,
                `$1"${version}"`,
            ),
    },
    {
        label: 'frontend/src-tauri/Cargo.lock',
        path: 'frontend/src-tauri/Cargo.lock',
        extract: (source) =>
            source.match(/\[\[package\]\]\nname = "ldaca-wordflow"\nversion = "([^"]+)"/)?.[1],
        replace: (source, version) =>
            source.replace(
                /(\[\[package\]\]\nname = "ldaca-wordflow"\nversion = )"[^"]+"/,
                `$1"${version}"`,
            ),
    },
    jsonTarget('frontend/src-tauri/tauri.conf.json', 'frontend/src-tauri/tauri.conf.json'),
];

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Returns the version represented by an exact release tag. */
export function versionFromReleaseTag(tag) {
    if (!tag) return null;
    if (!tag.startsWith('v') || !SEMVER.test(tag.slice(1))) {
        throw new Error(`Release tag must be v<semver>; received ${tag}`);
    }
    return tag.slice(1);
}

function tomlTarget(label, path) {
    return {
        label,
        path,
        extract: (source) => source.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
        replace: (source, version) =>
            source.replace(/(^version\s*=\s*)"[^"]+"/m, `$1"${version}"`),
    };
}

function jsonTarget(label, path) {
    return {
        label,
        path,
        extract: (source) => source.match(/"version"\s*:\s*"([^"]+)"/)?.[1],
        replace: (source, version) =>
            source.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${version}"`),
    };
}
