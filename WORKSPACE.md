# LDaCA Web App Workspace

This project uses **npm workspaces** to manage multiple packages in a monorepo structure.

## Project Structure

```text
ldaca_web_app/
├── package.json              # Root workspace configuration
├── frontend/                 # React frontend (workspace member)
│   ├── package.json
│   ├── src/
│   └── build/               # Vite build output
├── backend/                  # Python FastAPI backend
│   ├── pyproject.toml
│   └── dist-tauri/          # Packaged backend runtime for Tauri
└── src-tauri/               # Rust desktop wrapper
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
```

## Workspace Benefits

- **Single `npm install`** at root installs all workspace dependencies
- **Run scripts from root** using `-w <workspace>` flag
- **Shared dependencies** (e.g., `@tauri-apps/cli` at root level)
- **Cross-workspace commands** (e.g., build all, test all)

## Getting Started

### First-time Setup

```bash
# Install all dependencies (root + frontend)
npm install

# Package backend runtime
npm run prepare:backend

# Build frontend
npm run prepare:frontend

# Or build both
npm run prepare:all
```

### Development Workflows

#### Web Development (Frontend Only)

```bash
# Start frontend dev server (http://localhost:3000)
npm run dev

# Or explicitly target frontend workspace
npm run -w frontend dev
```

#### Desktop Development

```bash
# Start desktop app in dev mode (with hot reload)
npm run desktop:dev

# Or manually
npm run prepare:frontend
npm run tauri:dev
```

#### Production Build

```bash
# Build desktop app (creates DMG/AppImage/MSI)
npm run desktop:build

# Or step by step
npm run prepare:all
npm run tauri:build
```

## Available Scripts

### Root Level Scripts

| Script | Description |
|--------|-------------|
| `npm install` | Install all workspace dependencies |
| `npm run dev` | Start frontend dev server |
| `npm run build` | Build frontend for production |
| `npm run test` | Run frontend tests |
| `npm run tauri:dev` | Start Tauri desktop app (dev mode) |
| `npm run tauri:build` | Build Tauri desktop app (production) |
| `npm run desktop:dev` | Build frontend + start desktop dev |
| `npm run desktop:build` | Build everything + create installer |
| `npm run prepare:backend` | Package Python backend runtime for Tauri |
| `npm run prepare:frontend` | Build React frontend |
| `npm run prepare:all` | Build backend + frontend |
| `npm run clean` | Clean all build artifacts |

### Workspace-specific Scripts

```bash
# Run any frontend script from root
npm run -w frontend <script-name>

# Examples:
npm run -w frontend dev
npm run -w frontend build
npm run -w frontend test
npm run -w frontend lint
```

## Working with Workspaces

### Adding Dependencies

```bash
# Add to root (e.g., shared dev tools)
npm install -D <package> -w root

# Add to frontend workspace
npm install <package> -w frontend

# Or cd into workspace and use npm normally
cd frontend
npm install <package>
```

### Viewing Workspace Info

```bash
# List all workspaces
npm ls --workspaces

# Show workspace tree
npm ls --workspaces --depth=0
```

### Running Commands in All Workspaces

```bash
# Run script in all workspaces that have it
npm run test --workspaces

# Update all dependencies
npm update --workspaces
```

## IDE Integration

### VS Code

The workspace is automatically detected. You can:

- Run npm scripts from the NPM Scripts explorer
- Use integrated terminal with correct working directory
- Install the "NPM" extension for better workspace support

### WebStorm/IntelliJ

- Open the root `ldaca_web_app/` folder
- IDE will automatically detect workspaces
- Use the NPM tool window to run scripts

## Troubleshooting

### Issue: Dependencies not installing

```bash
# Clean and reinstall
rm -rf node_modules frontend/node_modules package-lock.json
npm install
```

### Issue: Frontend changes not reflected in desktop app

```bash
# Rebuild frontend before starting Tauri
npm run prepare:frontend
npm run tauri:dev
```

### Issue: Tauri CLI not found

```bash
# Ensure @tauri-apps/cli is installed at root
npm install -D @tauri-apps/cli
```

## Migration Notes

If you're migrating from the old structure:

1. **Before**: Had to run `cd frontend && npm install` separately
2. **After**: Just run `npm install` at root

3. **Before**: `cd frontend && npm run build`
4. **After**: `npm run build` (from root)

5. **Scripts are now centralized** in root `package.json` using `-w frontend` flag

## Best Practices

1. **Always run `npm install` from root** (not inside workspaces)
2. **Use workspace scripts from root** for consistency
3. **Keep workspace `package.json` files focused** on their specific dependencies
4. **Share dev tools at root level** (like `@tauri-apps/cli`)
5. **Document new scripts** in this file when adding them

## Further Reading

- [npm workspaces documentation](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
- [Tauri documentation](https://tauri.app/)
- [Vite documentation](https://vitejs.dev/)
