import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { captureActivationFromUrl } from './lib/activation';
import './styles.css';

// Must run before anything else so the private token leaves the address bar immediately.
captureActivationFromUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
