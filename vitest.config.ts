import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'test/coverage',
      reportOnFailure: true,
      all: false,
      include: ['src/**/*'],
    },
  },
});

