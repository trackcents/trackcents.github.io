import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: true
    }),
    // Base path for deployment. Empty = root (a user/org Pages site
    // `username.github.io`, or a custom domain) — all internal links work as-is.
    // For a PROJECT site `username.github.io/<repo>`, set BASE_PATH=/<repo> at
    // build time (the deploy workflow forwards it). See reports/overnight-build/BLOCKERS.md.
    paths: {
      base: process.env.BASE_PATH || ''
    },
    alias: {
      $lib: 'src/lib',
      $components: 'src/components'
    },
    serviceWorker: {
      register: false
    }
  }
};

export default config;
