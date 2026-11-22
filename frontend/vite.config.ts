import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { sentryVitePlugin } from '@sentry/bundler-plugins/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8000';
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN || '';
  const sentryOrg = process.env.SENTRY_ORG || env.SENTRY_ORG || '';
  const sentryProject = process.env.SENTRY_PROJECT || env.SENTRY_PROJECT || '';
  const canUploadSourceMaps = Boolean(sentryAuthToken && sentryOrg && sentryProject);

  return {
    plugins: [
      react(),
      ...(canUploadSourceMaps
        ? [
            sentryVitePlugin({
              org: sentryOrg,
              project: sentryProject,
              authToken: sentryAuthToken,
              release: { name: env.VITE_SENTRY_RELEASE || process.env.GITHUB_SHA || 'local' },
              sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    optimizeDeps: {
      // Skip Vite's cold source crawl; keep imported browser dependencies explicit here.
      noDiscovery: true,
      holdUntilCrawlEnd: false,
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-dev-runtime',
        'react/jsx-runtime',
        'react-router-dom',
        'react-redux',
        '@reduxjs/toolkit',
        '@reduxjs/toolkit/query',
        '@reduxjs/toolkit/query/react',
        '@sentry/react',
        '@hookform/resolvers/zod',
        '@vvo/tzdb',
        '@fullcalendar/daygrid',
        '@fullcalendar/interaction',
        '@fullcalendar/react',
        '@fullcalendar/timegrid',
        'date-fns',
        'date-fns-tz',
        'lucide-react',
        'qrcode-generator',
        'react-hook-form',
        'zod',
      ],
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: ['frontend'],
      // Docker bind mounts on Windows/macOS do not forward file events; poll there so edits reload.
      ...(env.VITE_USE_POLLING === 'true'
        ? {
            watch: {
              usePolling: true,
              interval: 1000,
              ignored: [
                '**/node_modules/**',
                '**/.git/**',
                '**/.npm-cache/**',
                '**/test-results/**',
                '**/playwright-report/**',
                '**/dist/**',
                '**/e2e/**',
              ],
            },
          }
        : {}),
      warmup: {
        clientFiles: [
          './index.html',
          './src/features/auth/LoginPage.tsx',
          './src/features/dashboard/DashboardPage.tsx',
          './src/features/dashboard/SettingsPage.tsx',
          './src/features/appearance/AppearancePage.tsx',
          './src/features/appointments/BookingPage.tsx',
          './src/features/appointments/CalendarPage.tsx',
        ],
      },
      proxy: {
        '/api': { target: apiProxyTarget, changeOrigin: true },
        '/docs': { target: apiProxyTarget, changeOrigin: true },
        '/openapi.json': { target: apiProxyTarget, changeOrigin: true },
        '/health': { target: apiProxyTarget, changeOrigin: true },
      },
    },
    build: {
      sourcemap: canUploadSourceMaps ? 'hidden' : false,
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['e2e/**'],
      setupFiles: './src/test/setup.ts',
    },
  };
});
