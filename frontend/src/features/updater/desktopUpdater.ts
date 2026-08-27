import { Channel, invoke } from '@tauri-apps/api/core';

export interface UpdateMetadata {
  currentVersion: string;
  version: string;
  publicationDate: string | null;
  notes: string | null;
}

export type UpdaterSnapshot =
  | { status: 'idle' }
  | { status: 'available'; update: UpdateMetadata }
  | { status: 'downloading'; update: UpdateMetadata }
  | { status: 'readyToInstall'; update: UpdateMetadata }
  | { status: 'installing' };

export type CheckOutcome =
  | { status: 'upToDate'; currentVersion: string }
  | { status: 'available'; update: UpdateMetadata };

export type DownloadEvent =
  | { event: 'started'; data: { contentLength: number | null } }
  | { event: 'progress'; data: { chunkLength: number } }
  | { event: 'finished' };

export interface UpdatePreferences {
  automaticChecks: boolean;
}

export function getUpdaterSnapshot(): Promise<UpdaterSnapshot> {
  return invoke('get_updater_snapshot');
}

export function checkForUpdates(): Promise<CheckOutcome> {
  return invoke('check_for_updates');
}

export function downloadUpdate(onEvent: (event: DownloadEvent) => void): Promise<void> {
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = onEvent;
  return invoke('download_update', { onEvent: channel });
}

export function installUpdate(): Promise<void> {
  return invoke('install_update');
}

export function dismissUpdate(disposition: 'later' | 'skip'): Promise<void> {
  return invoke('dismiss_update', { disposition });
}

export function openUpdateLink(url: string): Promise<void> {
  return invoke('open_update_link', { url });
}

export function getUpdatePreferences(): Promise<UpdatePreferences> {
  return invoke('get_update_preferences');
}

export function setAutomaticUpdateChecks(enabled: boolean): Promise<UpdatePreferences> {
  return invoke('set_automatic_update_checks', { enabled });
}
