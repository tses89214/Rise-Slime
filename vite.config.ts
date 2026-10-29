import { defineConfig } from 'vite';

// ponytail: assets/ is served at the site root (/original, /fonts, /audio); assets/original/preview also ships, ~30KB.
export default defineConfig({ publicDir: 'assets' });
