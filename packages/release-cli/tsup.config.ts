import { defineConfig } from 'tsup';
import nodePreset from '@kb-labs/devkit/tsup/node.js';
import globby from 'globby';

export default defineConfig({
  ...nodePreset,
  entry: [
    'src/index.ts',
    'src/manifest.v2.ts',
    'src/setup/handler.ts',
    'src/contracts/release.schema.ts',
    'src/rest/handlers/plan-handler.ts',
    'src/rest/handlers/report-handler.ts',
    ...globby.sync('src/cli/commands/*.ts')
  ],
  tsconfig: "tsconfig.build.json", // Use build-specific tsconfig without paths
});

