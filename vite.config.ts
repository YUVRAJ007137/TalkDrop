import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	define: {
		// simple-peer and its deps (e.g. randombytes) expect Node's `global` in the browser
		global: 'globalThis'
	},
	resolve: {
		// readable-stream (used by simple-peer) requires 'events'; alias so it resolves to the npm package
		alias: {
			events: 'events'
		}
	},
	optimizeDeps: {
		include: ['events']
	},
	server: {
		port: 5173
	}
}); 