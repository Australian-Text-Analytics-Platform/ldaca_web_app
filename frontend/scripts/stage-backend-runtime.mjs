import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');
const sourceRuntime = path.join(repoRoot, 'dist-tauri', 'backend-runtime');
const targetRuntime = path.join(
  frontendRoot,
  'src-tauri',
  'backend-runtime',
);

if (!fs.existsSync(sourceRuntime)) {
  console.error(`Backend runtime not found at: ${sourceRuntime}`);
  console.error('Run backend packaging first.');
  process.exit(1);
}

fs.rmSync(targetRuntime, { recursive: true, force: true });
fs.mkdirSync(path.dirname(targetRuntime), { recursive: true });
fs.cpSync(sourceRuntime, targetRuntime, { recursive: true });

// ---------------------------------------------------------------------------
// Copy MSVC C++ runtime DLLs to managed-python so C extension modules
// (greenlet, etc.) work on machines without VC++ Redistributable installed.
// managed-python ships vcruntime140.dll but NOT msvcp140.dll which some .pyd
// files link against. We copy from the system; if unavailable, the build
// continues and the app will require VC++ Redistributable on the target machine.
// ---------------------------------------------------------------------------
if (process.platform === 'win32') {
  const managedPythonDir = path.join(targetRuntime, 'managed-python');
  const cpythonDirs = fs.existsSync(managedPythonDir)
    ? fs.readdirSync(managedPythonDir).filter(n => n.startsWith('cpython-'))
    : [];
  if (cpythonDirs.length > 0) {
    const cpythonDir = path.join(managedPythonDir, cpythonDirs[0]);
    const msvcDlls = ['msvcp140.dll', 'msvcp140_1.dll', 'concrt140.dll'];
    const systemDirs = [
      path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32'),
    ];
    for (const dll of msvcDlls) {
      const dest = path.join(cpythonDir, dll);
      if (fs.existsSync(dest)) continue;
      for (const sysDir of systemDirs) {
        const src = path.join(sysDir, dll);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`Copied ${dll} from ${sysDir} to managed-python`);
          break;
        }
      }
    }
  }
}

const manifestPath = path.join(targetRuntime, 'runtime-manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`runtime-manifest.json missing at: ${manifestPath}`);
  process.exit(1);
}

// Rewrite runtime-manifest.json to remove build-machine absolute paths.
// These fields are informational; make them relative so they don't mislead
// and they stay valid after the runtime is relocated.
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

// Point to managed-python's real interpreter, NOT the venv stub launcher.
// The venv Scripts/python.exe reads pyvenv.cfg which has build-machine paths
// that won't exist on other machines. The Rust launcher sets PYTHONHOME and
// PYTHONPATH so the real interpreter finds everything it needs.
if (manifest.python_executable) {
  const managedPythonDir = path.join(targetRuntime, 'managed-python');
  const cpythonDirs = fs.existsSync(managedPythonDir)
    ? fs.readdirSync(managedPythonDir).filter(n => n.startsWith('cpython-'))
    : [];
  if (cpythonDirs.length > 0) {
    manifest.python_executable = process.platform === 'win32'
      ? `managed-python/${cpythonDirs[0]}/python.exe`
      : `managed-python/${cpythonDirs[0]}/bin/python3`;
  } else {
    // Fallback if managed-python not found
    manifest.python_executable = process.platform === 'win32'
      ? 'python/python.exe'
      : 'python/bin/python3';
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
console.log('Rewrote runtime-manifest.json with relative paths');

// Rewrite pyvenv.cfg to replace the absolute `home` path with a relative one
// pointing to the co-shipped managed-python installation.
// On other machines the original build-machine path won't exist.
const pyvenvCfg = path.join(targetRuntime, 'python', 'pyvenv.cfg');
if (fs.existsSync(pyvenvCfg)) {
  let cfg = fs.readFileSync(pyvenvCfg, 'utf-8');
  // Find the managed-python cpython directory that was shipped
  const managedPythonDir = path.join(targetRuntime, 'managed-python');
  if (fs.existsSync(managedPythonDir)) {
    const cpythonDirs = fs.readdirSync(managedPythonDir)
      .filter(name => name.startsWith('cpython-'));
    if (cpythonDirs.length > 0) {
      const cpythonDir = path.join(managedPythonDir, cpythonDirs[0]);
      // Replace the absolute home path with the actual co-shipped location
      cfg = cfg.replace(/^home\s*=\s*.+$/m, `home = ${cpythonDir}`);
      fs.writeFileSync(pyvenvCfg, cfg, 'utf-8');
      console.log(`Rewrote pyvenv.cfg home to: ${cpythonDir}`);
    }
  }
}

console.log(`Staged backend runtime to: ${targetRuntime}`);

// Create sitecustomize.py in site-packages to register managed-python as a
// DLL search directory. Since Python 3.8+ on Windows, extension modules (.pyd)
// no longer find DLLs via PATH — os.add_dll_directory() is required.
// Without this, C extensions like greenlet, numpy, etc. fail on clean machines
// that lack the Visual C++ Redistributable in system directories.
const sitePackagesDir = path.join(targetRuntime, 'python', 'Lib', 'site-packages');
if (fs.existsSync(sitePackagesDir)) {
  const sitecustomize = `\
# Auto-generated by stage-backend-runtime.mjs
# Ensures C extension DLLs (vcruntime140.dll etc.) from the managed CPython
# installation are findable by extension modules (greenlet, numpy, etc.).
import os as _os, sys as _sys
if _sys.platform == "win32" and hasattr(_os, "add_dll_directory"):
    _home = _os.environ.get("PYTHONHOME", "")
    if _home and _os.path.isdir(_home):
        try:
            _os.add_dll_directory(_home)
        except OSError:
            pass
`;
  fs.writeFileSync(path.join(sitePackagesDir, 'sitecustomize.py'), sitecustomize, 'utf-8');
  console.log('Created sitecustomize.py for DLL search directory registration');
}
