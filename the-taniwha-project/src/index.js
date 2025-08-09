import { TANIWHA_CONFIG } from './config.js';
import { createApp } from './ui.js';

(function(){
  const root = document.getElementById('taniwha-root');
  if (!root) return;
  const shadow = root.attachShadow({ mode: 'open' });
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = (window.TANIWHA_REPO_BASE_URL || '') + '/dist/taniwha.css';
  shadow.appendChild(link);
  const container = document.createElement('div');
  container.className = 'taniwha-root';
  shadow.appendChild(container);
  const app = createApp(container, TANIWHA_CONFIG);
  app.render();
})();