import { defineConfig } from 'tsup';
import nodePreset from '@kb-labs/devkit/tsup/node';
import globby from 'globby';

export default defineConfig({
  ...nodePreset,
  entry: [
    'src/index.ts',
    'src/manifest.ts',
    'src/setup/handler.ts',
    'src/contracts/release.schema.ts',
    ...globby.sync('src/cli/commands/*.ts'),
    ...globby.sync('src/rest/handlers/*.ts')
  ],
  tsconfig: "tsconfig.build.json", // Use build-specific tsconfig without paths
});

