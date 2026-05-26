import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
    strictPort: true,
    // Tell Vite's file watcher and CSS plugin to ignore these directories.
    // Without this, running `pnpm mutate` (Stryker) creates temporary
    // `.stryker-tmp/sandbox-*` copies of the repo; Vite indexes them as
    // legit project files, then Stryker cleans up, leaving Vite holding
    // dangling path references — the dev server then 500s on every
    // request with a "favicon.svg not found in sandbox-XYZ" overlay.
    // Same risk for the other test/build temp dirs.
    watch: {
      ignored: [
        '**/.stryker-tmp/**',
        '**/coverage/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/reports/**'
      ]
    },
    fs: {
      // Don't let Vite serve files from these directories even if asked.
      deny: ['.stryker-tmp', 'coverage', 'test-results', 'playwright-report', 'reports']
    }
  },
  optimizeDeps: {
    // Stryker's sandbox contains a partial node_modules; if Vite pre-bundles
    // dependencies from there, the references go stale after sandbox cleanup.
    exclude: []
  }
});
