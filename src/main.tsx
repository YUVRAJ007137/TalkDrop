import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './ui/App';
import './ui/styles.css';

const container = document.getElementById('root') as HTMLElement | null;
if (!container) {
	throw new Error('Root container not found');
}

const root = createRoot(container);
root.render(
	<React.StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</React.StrictMode>
); 