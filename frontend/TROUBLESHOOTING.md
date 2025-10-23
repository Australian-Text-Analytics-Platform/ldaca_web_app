# Troubleshooting Guide

## Common Issues and Solutions

### ✅ React Context Error (Fixed in v0.1.3+)

**Previous Issue**: Versions before 0.1.3 ran in development mode and could show "useWorkspaceContext must be used within a WorkspaceProvider" error on first load.

**Current Status**: Version 0.1.3+ ships with production builds, eliminating this issue entirely. If you still see this error:

1. **Update to latest version**:
   ```bash
   npx ldaca_web_app_frontend@latest
   ```

2. **If error persists with latest version**:
   - Clear npm cache: `npm cache clean --force`
   - Try with explicit version: `npx ldaca_web_app_frontend@0.1.3`

3. **For local development**:
   ```bash
   # Clone the repository
   git clone https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app.git
   cd ldaca_web_app/frontend
   
   # Install and run
   npm install
   npm run dev
   ```

### Backend Connection Issues

**Symptom**: Frontend loads but shows "Backend not ready" or API errors.

**Solution**:
1. Make sure backend is running first:
   ```bash
   uvx ldaca_web_app_backend
   ```

2. Check ports match:
   ```bash
   # If backend is on port 9000
   BACKEND_PORT=9000 uvx ldaca_web_app_backend
   
   # Frontend needs to know
   VITE_BACKEND_PORT=9000 npx ldaca_web_app_frontend
   ```

### Port Already in Use

**Symptom**: "Error: listen EADDRINUSE: address already in use"

**Solution**:
```bash
# Use a different port
FRONTEND_PORT=4000 npx ldaca_web_app_frontend
```

### Slow npm install

**Symptom**: `npm install` takes a very long time when running via npx

**Solution**:
- This is normal on first run - the frontend has many dependencies
- Subsequent runs reuse the installed packages
- Consider using a local installation for development

### Dependencies Not Installing

**Symptom**: Vite fails to start with "Cannot find module" errors

**Solution**:
1. Clear npm cache:
   ```bash
   npm cache clean --force
   ```

2. Try again:
   ```bash
   npx ldaca_web_app_frontend
   ```

3. If still failing, install globally:
   ```bash
   npm install -g ldaca_web_app_frontend
   ldaca_web_app_frontend
   ```

## Environment-Specific Issues

### Google Colab

**Issue**: Context errors are more common in Colab due to iframe isolation

**Solution**: Use the Python deployment script instead of npx:
```python
from ldaca_web_app_backend.deploy import start_backend, start_frontend

start_backend(port=8001)
start_frontend(port=3000, download_release=True)  # Uses pre-built static files
```

### JupyterHub

**Issue**: Proxy path configuration

**Solution**: The app auto-detects JupyterHub proxy paths. No configuration needed.

## Development vs Production

The `npx` command runs the **development server** (Vite), which:
- Includes Hot Module Replacement
- May have React Strict Mode issues
- Best for development

For production deployment, build static files:
```bash
git clone https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app.git
cd ldaca_web_app/frontend
npm install
npm run build

# Serve the build folder
npx serve build -p 3000
```

## Still Having Issues?

1. Check the browser console for detailed error messages
2. Try with a different browser
3. Check that backend is running and accessible
4. Open an issue: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/issues

## Reporting Bugs

When reporting issues, please include:
- Operating system
- Node.js version (`node --version`)
- npm version (`npm --version`)
- Full error message from terminal
- Browser console errors (F12 → Console tab)
- Command you ran
