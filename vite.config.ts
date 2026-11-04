import { defineConfig } from 'vite';

// ponytail: assets/ is served next to index.html (original/, fonts/, audio/); relative paths + base './' so itch.io can host it under a subpath; assets/original/preview also ships, ~30KB.
export default defineConfig({ publicDir: 'assets', base: './' });
