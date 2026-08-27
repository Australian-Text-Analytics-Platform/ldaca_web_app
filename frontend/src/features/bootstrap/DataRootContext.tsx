import { createContext, useContext } from 'react';

type DataRootState =
  | 'unconfigured'
  | 'initializing'
  | 'ready'
  | 'reconfiguring'
  | 'configuration_error'
  | 'stopping';

export interface DataRootResource {
  state: DataRootState;
  source: 'environment' | 'config' | 'none';
  data_root: string | null;
  suggested_data_root: string | null;
  mutable: boolean;
  runtime_generation: number;
  error: { code: string; message: string } | null;
  change_token: string | null;
}

export interface DataRootContextValue {
  resource: DataRootResource;
  configureDataRoot: (dataRoot: string) => Promise<DataRootResource>;
}

export const DataRootContext = createContext<DataRootContextValue | null>(null);

export function useDataRoot(): DataRootContextValue {
  const value = useContext(DataRootContext);
  if (!value) throw new Error('Data Root context is unavailable');
  return value;
}
