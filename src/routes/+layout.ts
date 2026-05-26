// Pure SPA mode — no server-side rendering. SvelteKit `adapter-static` with
// `fallback: 'index.html'` plus this `ssr = false` flag produces a static
// PWA bundle suitable for GitHub Pages.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
