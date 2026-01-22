# Backend Packaging (Executable)

**Scope statement:** Build a standalone backend executable for desktop distribution.

## Step 1 — Prepare the build

**Question:** *What do I need installed?*

**Answer:** Python 3.12+, the workspace dependencies, and PyInstaller (included in dev dependencies).

## Step 2 — Build the executable

**Question:** *How do I produce the bundle?*

**Answer:** Run the backend build script from the backend directory (see `build_executable.sh`).

## Step 3 — Validate output

**Question:** *Where is the executable located?*

**Answer:** Under `backend/dist/` in the PyInstaller bundle directory.

## Recap

**Question:** *Where does this fit in the desktop build?*

**Answer:** The desktop app packaging process expects this bundle and will include it when creating installers.
