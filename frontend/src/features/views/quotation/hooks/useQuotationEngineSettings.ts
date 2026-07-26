import { useState } from 'react';
import type { QuotationEngineConfig } from '@/api';

export type QuotationEngineRequestPayload =
  | { type: 'local'; engine_id?: string }
  | { type: 'remote'; engine_id: string };

type QuotationResolvedEnginePayload =
  | { type: 'local' }
  | { type: 'remote'; engineId: string; isValid: boolean };

export interface UseQuotationEngineSettingsResult {
  engineConfig: QuotationEngineConfig;
  lastRemoteEngineId: string;
  engineError: string | null;
  resolvedEnginePayload: QuotationResolvedEnginePayload;
  engineReady: boolean;
  setTaskEngineConfig: (config: QuotationEngineConfig) => void;
  updateRemoteEngineId: (engineId: string) => void;
  hydrateEngineConfig: (config: QuotationEngineConfig | null | undefined) => void;
  buildEngineRequest: () => QuotationEngineRequestPayload | null;
}

/**
 * Owns the quotation task-level engine settings model.
 *
 * Used by: QuotationFeature because engine selection is a product parameter
 * with UI memory (last remote URL), validation feedback, request normalization,
 * and hydration rules that should not leak into the generic quotation task
 * Preview and Run All flow.
 *
 * Flow: keep the active local/remote config and remembered remote endpoint
 * together, normalize saved or user-entered URLs, expose request-ready engine
 * payloads, and surface validation errors for the parameter form.
 */
export function useQuotationEngineSettings(): UseQuotationEngineSettingsResult {
  const [engineConfig, setEngineConfig] = useState<QuotationEngineConfig>({ type: 'local' });
  const [lastRemoteEngineId, setLastRemoteEngineId] = useState('');
  const [engineError, setEngineError] = useState<string | null>(null);

  /** Applies a task engine config from direct UI selection or hydration. */
  // Called by: QuotationEngineSettingsFields and task hydration because engine settings belong to a single quotation tab/run.
  const setTaskEngineConfig = (config: QuotationEngineConfig) => {
    setEngineConfig(config);
    if (config.type === 'remote' && config.engine_id) {
      setLastRemoteEngineId(config.engine_id);
    }
    setEngineError(null);
  };

  /** Updates the remembered remote engine id and active request configuration. */
  const updateRemoteEngineId = (engineId: string) => {
    setLastRemoteEngineId(engineId);
    setEngineConfig((current: QuotationEngineConfig) =>
      current.type === 'remote' ? { type: 'remote', engine_id: engineId } : current,
    );
    setEngineError(null);
  };

  /** Restores engine config from a saved quotation request. */
  // Called by: QuotationFeature task hydration because reloaded tabs should reopen with the backend-stored engine choice.
  const hydrateEngineConfig = (config: QuotationEngineConfig | null | undefined) => {
    if (config?.type === 'remote') {
      const engineId = (config.engine_id ?? '').trim();
      if (!engineId.length) return;
      setTaskEngineConfig({ type: 'remote', engine_id: engineId });
      return;
    }
    if (config?.type === 'local') {
      setTaskEngineConfig({ type: 'local' });
    }
  };

  const resolvedEnginePayload: QuotationResolvedEnginePayload =
    engineConfig.type === 'remote'
      ? {
          type: 'remote',
          engineId: (engineConfig.engine_id ?? '').trim(),
          isValid: Boolean((engineConfig.engine_id ?? '').trim()),
        }
      : { type: 'local' };

  const engineReady = resolvedEnginePayload.type === 'local' ? true : resolvedEnginePayload.isValid;

  /** Validates the current UI config and returns the backend request payload. */
  // Called before Preview and Run All because every backend action must use the same engine normalization rules.
  const buildEngineRequest = (): QuotationEngineRequestPayload | null => {
    if (resolvedEnginePayload.type === 'local') {
      if (engineError !== null) setEngineError(null);
      return { type: 'local' };
    }

    if (!resolvedEnginePayload.engineId.length) {
      setEngineError('Provide a remote quotation engine id.');
      return null;
    }

    if (!resolvedEnginePayload.isValid) {
      setEngineError('Enter a remote quotation engine id.');
      return null;
    }

    const normalizedEngineId = resolvedEnginePayload.engineId;
    if ((engineConfig.engine_id ?? '').trim() !== normalizedEngineId) {
      updateRemoteEngineId(normalizedEngineId);
    } else if (engineError !== null) {
      setEngineError(null);
    }
    return { type: 'remote', engine_id: normalizedEngineId };
  };

  return {
    engineConfig,
    lastRemoteEngineId,
    engineError,
    resolvedEnginePayload,
    engineReady,
    setTaskEngineConfig,
    updateRemoteEngineId,
    hydrateEngineConfig,
    buildEngineRequest,
  };
}
