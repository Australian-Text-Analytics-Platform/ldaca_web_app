"""
Transform React.FC usage to type-only FC imports across the frontend.

Changes:
1. `React.FC<Props>` → `FC<Props>` with proper type import
2. `React.FC` (no props) → `FC` with proper type import
3. Updates imports: type-only where possible, additive where React namespace still used

Run: uv run python3 scripts/transform_react_fc.py && pnpm -C frontend build
"""

import re
import os
import subprocess

SRC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'src')

def find_fc_files():
    result = subprocess.run(
        ['rg', 'React\\.FC', '-g', '*.tsx', '-l', SRC_DIR],
        capture_output=True, text=True
    )
    files = [f.strip() for f in result.stdout.strip().split('\n') if f.strip()]
    return files

def has_other_react_usage(content):
    """Check if file uses `React.xxx` beyond `React.FC`."""
    without_fc = re.sub(r'React\.FC', '', content)
    return bool(re.search(r'React\.', without_fc))

def transform_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    original = content

    # --- Step 1: Replace React.FC<Props> with FC<Props> ---
    content = re.sub(r'React\.FC<([^>]*(?:<(?:[^>]*)>[^>]*)*)>', r'FC<\1>', content)

    # --- Step 2: Replace standalone React.FC (no angle brackets) with FC ---
    content = re.sub(r'(?<![.\w$])React\.FC(?!\s*<)', 'FC', content)

    # --- Step 3: Update imports ---
    other = has_other_react_usage(content)
    if content == original:
        return False

    lines = content.split('\n')
    new_lines = []
    react_imported = False
    fc_added = False
    needs_fc = 'FC<' in content or re.search(r'\bFC\b', content)

    for line in lines:
        # Detect existing React import lines
        default_match = re.match(r'^import React(,\s*\{([^}]*)\})?\s+from\s+[\'"]react[\'"]\s*;?\s*$', line)
        namespace_match = re.match(r'^import \* as React from [\'"]react[\'"]\s*;?\s*$', line)
        named_match = re.match(r'^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+[\'"]react[\'"]\s*;?\s*$', line)

        if default_match:
            react_imported = True
            if other:
                # React namespace still used — keep import, add type FC if not present
                if needs_fc and 'FC' not in line and 'type FC' not in line:
                    has_named = default_match.group(2) is not None
                    if has_named:
                        inner = default_match.group(2)
                        if 'type FC' not in inner:
                            new_line = line.replace(f'{{{inner}}}', f'{{{inner.strip()}, type FC}}')
                            new_lines.append(new_line)
                            fc_added = True
                            continue
                    else:
                        line = line.rstrip()
                        if ';' in line:
                            line = line.replace("import React from 'react';", "import React, { type FC } from 'react';")
                        else:
                            line = line.replace("import React from 'react'", "import React, { type FC } from 'react'")
                        new_lines.append(line)
                        fc_added = True
                        continue
                new_lines.append(line)
            elif needs_fc:
                # React only used for FC — convert to type-only import
                has_named = default_match.group(2) is not None
                if has_named:
                    inner = default_match.group(2)
                    fc_added = True
                    new_line = f"import {{ {inner.strip()}, type FC }} from 'react'"
                    new_lines.append(new_line)
                else:
                    fc_added = True
                    new_lines.append("import type { FC } from 'react'")
            else:
                new_lines.append(line)
            continue

        if namespace_match:
            react_imported = True
            if needs_fc and not other:
                fc_added = True
                new_lines.append("import type { FC } from 'react'")
            else:
                new_lines.append(line)
            continue

        if named_match and 'FC' not in line:
            # Named import with type — add FC
            inner = named_match.group(1).strip()
            if needs_fc and 'FC' not in inner and 'type FC' not in inner:
                new_line = line.replace(f'{{{inner}}}', f'{{{inner}, type FC}}')
                new_lines.append(new_line)
                fc_added = True
                continue
            new_lines.append(line)
            continue

        new_lines.append(line)

    if needs_fc and not fc_added and not react_imported:
        # No React import exists — add one
        new_lines.insert(0, "import type { FC } from 'react'")

    content = '\n'.join(new_lines)

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

def main():
    files = find_fc_files()
    print(f"Found {len(files)} files with React.FC")

    transformed = 0
    for filepath in files:
        if not os.path.exists(filepath):
            print(f"  NOT FOUND: {filepath}")
            continue
        if transform_file(filepath):
            print(f"  ✓ {os.path.basename(filepath)}")
            transformed += 1

    print(f"\nTransformed: {transformed} / {len(files)} files")

    # Verify no React.FC remains
    remaining = find_fc_files()
    if remaining:
        print(f"\n⚠ Remaining React.FC in {len(remaining)} files:")
        for f in remaining:
            print(f"  {f}")
    else:
        print("\n✓ No React.FC remains")

if __name__ == '__main__':
    main()
