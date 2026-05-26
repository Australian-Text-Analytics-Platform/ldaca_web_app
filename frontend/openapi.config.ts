import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi/ldaca-wordflow.openapi.json',
  output: './src/api/generated',
  plugins: [
    '@hey-api/typescript',
    '@hey-api/sdk',
    {
      name: '@hey-api/client-fetch',
      runtimeConfigPath: './src/api/generatedClientConfig',
    },
    {
      name: '@tanstack/react-query',
      queryOptions: true,
      mutationOptions: true,
      queryKeys: {
        tags: true,
      },
    },
  ],
});