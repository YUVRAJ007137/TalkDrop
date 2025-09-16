import type { Config } from 'tailwindcss';

export default {
	content: ['./index.html', './src/**/*.{ts,tsx}'],
	theme: {
		extend: {
			colors: {
				wa: {
					bg: '#0b141a',
					panel: '#202c33',
					panelLight: '#2a3942',
					accent: '#25d366',
					accentDark: '#128c7e',
					text: '#e9edef',
					muted: '#aebac1',
				}
			}
		}
	}
} satisfies Config; 