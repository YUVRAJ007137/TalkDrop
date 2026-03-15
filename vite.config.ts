import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	define: {
		// simple-peer and its deps (e.g. randombytes) expect Node's `global` in the browser
		global: 'globalThis'
	},
	server: {
		port: 5173
	}
}); 