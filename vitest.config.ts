import { playwright } from '@vitest/browser-playwright'
import react from '@vitejs/plugin-react'
import { defineConfig, defineProject } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      defineProject({
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      }),
      defineProject({
        plugins: [react()],
        test: {
          name: 'component',
          include: ['src/**/*.browser.test.tsx'],
          setupFiles: ['./src/test/browser.setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: { channel: 'chrome' },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      }),
    ],
  },
})
