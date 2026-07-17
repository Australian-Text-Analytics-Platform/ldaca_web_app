// Public barrel for canonical generated API contracts. Consumers import from '@/api'
// instead of reaching into generated/ files whose names are owned by hey-api.
export * from './generated';
export type { CreateClientConfig } from './generated/client.gen';
export * from './generated/@tanstack/react-query.gen';
export * from './frontendModels';
export * from './tableApi';
