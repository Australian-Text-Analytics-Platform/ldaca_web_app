import { createRoot } from 'react-dom/client';

import '@/index.css';
import { UpdaterWindow } from '@/features/updater/UpdaterWindow';
import { startThemeStorageSync } from '@/features/theme/themeRuntime';

startThemeStorageSync();

const root = document.getElementById('root');
if (!root) throw new Error('Root container #root not found');

const mode =
  new URLSearchParams(window.location.search).get('mode') === 'available' ? 'available' : 'manual';
createRoot(root).render(<UpdaterWindow mode={mode} />);
