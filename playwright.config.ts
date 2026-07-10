import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { baseURL: 'http://127.0.0.1:8765', trace: 'retain-on-failure' },
  webServer: {
    command: 'VIDEO_ROOT=$PWD/test-results/e2e-media ALLOW_DIRECT=1 STATE_PATH=$PWD/test-results/state.json .venv/bin/uvicorn personal_video_studio.app.server:app --host 127.0.0.1 --port 8765 --no-access-log',
    url: 'http://127.0.0.1:8765/api/health',
    reuseExistingServer: false,
  },
});

