import { postToMake } from './api.js';
import { createDecoder } from './decoder.js';

export function startScannerApp(container, config){
  const mount = document.createElement('div');
  mount.textContent = 'Use dist/taniwha.bundle.js in production. This src stub is for dev only.';
  container.appendChild(mount);
  return { render(){}, };
}