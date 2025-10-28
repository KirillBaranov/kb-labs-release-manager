import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    reporters: ["default"],
    exclude: ["node_modules", "dist", "**/dist/**"],
    coverage: {
      provider: "v8",
      all: true,
      reportsDirectory: "./coverage",
      reporter: ["text", "html"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/__tests__/**",
        "**/*.d.ts",
        "**/types.ts",
        "**/types/**",
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
