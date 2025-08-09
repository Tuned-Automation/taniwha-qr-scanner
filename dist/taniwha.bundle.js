(function(){
  'use strict';

  const DEFAULT_CONFIG = {
    MAKE_WEBHOOK_URL: 'https://hook.us1.make.com/pzqgij335egnnf1xkhwtaj8qrikkordk',
    CORS_MODE: 'cors',
    REQUEST_TIMEOUT_MS: 8000,
    ALLOW_FILE_UPLOAD_FALLBACK: true,
    ENABLE_WORKER: false,
    UI: {
      title: 'Scan your voucher',
      subtitle: 'Align the QR within the frame',
      confirmLabel: 'Confirmed',
      denyLabel: 'Denied',
      errorLabel: 'Something went wrong',
      retryLabel: 'Try again',
    },
  };

  const REPO_BASE_URL = (function(){
    if (typeof window !== 'undefined' && window.TANIWHA_REPO_BASE_URL) return window.TANIWHA_REPO_BASE_URL.replace(/\/$/, '') + '/dist';
    try {
      const currentScript = document.currentScript || (function(){ const s = document.querySelector('script[src*="taniwha.bundle.js"]'); return s; })();
      if (!currentScript) return '';
      const url = new URL(currentScript.src, window.location.href);
      return url.href.replace(/\/taniwha\.bundle\.js.*$/, '');
    } catch(e) { return ''; }
  })();

  const CONFIG = Object.assign({}, DEFAULT_CONFIG, (window.TANIWHA_CONFIG_OVERRIDE||{}));

  const State = {
    Idle: 'idle',
    Scanning: 'scanning',
    Validating: 'validating',
    Confirmed: 'confirmed',
    Denied: 'denied',
    Error: 'error',
  };

  function maskEmail(email){
    if (!email || typeof email !== 'string') return '';
    const [name, domain] = email.split('@');
    if (!domain) return email;
    const masked = name.slice(0,1) + '***' + name.slice(-1);
    return masked + '@' + domain;
  }

  function extractToken(input){
    if (!input) return null;
    const str = String(input).trim();
    if (/^vch_[A-Za-z0-9_-]+$/.test(str)) return str;
    try {
      const url = new URL(str);
      const t = url.searchParams.get('t') || url.searchParams.get('token');
      if (t && /^vch_[A-Za-z0-9_-]+$/.test(t)) return t;
    } catch(_) {}
    // handle raw query fragments like batch=...&token=...
    const m = str.match(/[?&]?(?:token|t)=([^&\s]+)/i);
    if (m && /^vch_[A-Za-z0-9_-]+$/.test(m[1])) return m[1];
    return null;
  }

  function withTimeout(promise, ms){
    let to;
    const t = new Promise((_, reject)=>{ to = setTimeout(()=> reject(new Error('timeout')), ms); });
    return Promise.race([promise.finally(()=>clearTimeout(to)), t]);
  }

  async function postToMake(token){
    const body = {
      token,
      ts: Date.now(),
      ua: navigator.userAgent || 'unknown',
      source: 'taniwha-web'
    };
    const controller = new AbortController();
    const timer = setTimeout(()=> controller.abort('timeout'), CONFIG.REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(CONFIG.MAKE_WEBHOOK_URL, {
        method: 'POST',
        mode: CONFIG.CORS_MODE || 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('bad_status_' + res.status);
      const data = await res.json();
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function createEl(tag, cls, attrs){
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (attrs) for (const k in attrs){ if (attrs[k] != null) el.setAttribute(k, attrs[k]); }
    return el;
  }

  function mount(root){
    const shadow = root.attachShadow({ mode: 'open' });
    // Inject CSS into shadow root
    if (REPO_BASE_URL){
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = REPO_BASE_URL + '/taniwha.css';
      shadow.appendChild(link);
    }

    const container = createEl('div', 'taniwha-root');
    shadow.appendChild(container);

    const app = new App(container);
    app.render();

    // Add global click handler for button issues
    shadow.addEventListener('click', function(e) {
      const target = e.target;
      console.log('Shadow click detected on:', target.tagName, target.textContent);
      if (target && target.tagName === 'BUTTON') {
        console.log('Button clicked:', target.textContent);
        if (target.textContent && target.textContent.toLowerCase().includes('enter code instead')) {
          e.preventDefault();
          e.stopPropagation();
          console.log('Forcing manual entry via global handler');
          app.openManual();
        }
      }
    });

    // Force manual entry after a short delay
    setTimeout(() => {
      console.log('Auto-forcing manual entry...');
      app.openManual();
    }, 1500);

    // Expose a tiny control API for integration pages
    try {
      window.TANIWHA = window.TANIWHA || {};
      window.TANIWHA.openManual = () => app.openManual();
      const params = new URLSearchParams(location.search);
      const manualParam = (params.get('taniwha') === 'manual') || (params.get('taniwha_manual') === '1');
      if (window.TANIWHA_AUTO_MANUAL === true || manualParam) {
        // Defer to allow initial render to complete
        setTimeout(()=> app.openManual(), 0);
      }
    } catch(_) { /* ignore */ }
  }

  async function loadZXing(){
    if (window.ZXingBrowser) return window.ZXingBrowser;
    await new Promise((resolve, reject)=>{
      const s=document.createElement('script');
      s.src=(REPO_BASE_URL? (REPO_BASE_URL + '/vendor/zxing.min.js') : 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.4/umd/index.min.js');
      s.async=true; s.onload=()=> resolve(); s.onerror=()=> reject(new Error('failed_zxing_load'));
      document.head.appendChild(s);
    });
    // If vendor shim used, it will then load the real UMD and dispatch ready event; wait briefly
    if (!window.ZXingBrowser){
      await new Promise((resolve)=>{
        const to=setTimeout(resolve, 2000);
        document.addEventListener('taniwha-zxing-ready', ()=>{ clearTimeout(to); resolve(); }, { once: true });
      });
    }
    if (!window.ZXingBrowser) throw new Error('zxing_unavailable');
    return window.ZXingBrowser;
  }

  class Scanner {
    constructor(onDetect){
      this.onDetect = onDetect;
      this.video = null;
      this.stream = null;
      this.barcodeDetector = null;
      this.rafId = 0;
      this.lastDetectAt = 0;
      this.hintEl = null;
      this.hintTimer = null;
      this.zxingReader = null;
      this.usingZXing = false;
      this.active = false;
    }

    getView(){
      const wrap = createEl('div', 'taniwha-video-wrap taniwha-card taniwha-fade');
      const status = createEl('div', 'taniwha-status');
      status.setAttribute('aria-live', 'polite');
      status.textContent = 'Ready';
      status.classList.add('ready');

      const video = createEl('video', 'taniwha-video', { playsinline: 'true', muted: 'true' });
      video.setAttribute('autoplay', 'true');

      const frame = createEl('div', 'taniwha-frame');
      const scanline = createEl('div', 'taniwha-scanline');
      frame.appendChild(scanline);

      wrap.appendChild(status);
      wrap.appendChild(video);
      wrap.appendChild(frame);

      this.video = video;
      this.statusEl = status;

      return wrap;
    }

    async start(){
      this.active = true;
      this.setStatus('Scanning', 'scanning');
      try {
        const constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.stream = stream;
        this.video.srcObject = stream;
        await this.video.play().catch(()=>{});
        if ('BarcodeDetector' in window){
          try { this.barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
          catch(_) { this.barcodeDetector = null; }
        }
        if (this.barcodeDetector){ this.loopBarcodeDetector(); }
        else { await this.startZXing(); }

        // Hint if no detection for 10s
        clearTimeout(this.hintTimer);
        this.hintTimer = setTimeout(()=>{ if (this.active) this.setStatus('Try steadying the code or use Upload', 'scanning'); }, 10000);
      } catch (err){
        throw err;
      }
    }

    async startZXing(){
      const ZX = await loadZXing();
      this.usingZXing = true;
      const Reader = ZX.BrowserMultiFormatReader || ZX.BrowserQRCodeReader;
      this.zxingReader = new Reader();
      const devices = await ZX.BrowserCodeReader.listVideoInputDevices();
      let preferred = devices.find(d=> /back|rear|environment/i.test(d.label)) || devices[0];
      await this.zxingReader.decodeFromVideoDevice(preferred && preferred.deviceId || null, this.video, (result, err)=>{
        if (!this.active) return;
        if (result && result.getText){
          const text = result.getText();
          const token = extractToken(text);
          if (token){ this.handleDetected(token); }
        }
      });
    }

    loopBarcodeDetector(){
      const tick = async ()=>{
        if (!this.active) return;
        const now = performance.now();
        if (now - this.lastDetectAt < 66){ this.rafId = requestAnimationFrame(tick); return; }
        this.lastDetectAt = now;
        try {
          const barcodes = await this.barcodeDetector.detect(this.video);
          if (barcodes && barcodes.length){
            const raw = barcodes[0].rawValue || '';
            const token = extractToken(raw);
            if (token){ this.handleDetected(token); return; }
          }
        } catch(_) { /* ignore frame errors */ }
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    }

    setStatus(text, kind){
      if (!this.statusEl) return;
      this.statusEl.textContent = text;
      this.statusEl.className = 'taniwha-status ' + (kind||'');
    }

    async handleDetected(token){
      await this.pause();
      this.onDetect && this.onDetect(token);
    }

    async pause(){
      this.active = false;
      clearTimeout(this.hintTimer);
      if (this.zxingReader){
        try { await this.zxingReader.stopContinuousDecode(); } catch(_){}
        try { await this.zxingReader.reset(); } catch(_){}
      }
      if (this.rafId) cancelAnimationFrame(this.rafId);
      if (this.video) {
        try { this.video.pause(); } catch(_){ }
      }
      // keep stream to allow quick resume
    }

    async resume(){
      if (this.stream && this.video){
        this.active = true;
        this.setStatus('Scanning', 'scanning');
        try { await this.video.play(); } catch(_){}
        if (this.barcodeDetector) this.loopBarcodeDetector(); else await this.startZXing();
      } else {
        await this.start();
      }
    }

    async stop(){
      this.active = false;
      clearTimeout(this.hintTimer);
      if (this.zxingReader){ try { await this.zxingReader.stopContinuousDecode(); } catch(_){}
        try { await this.zxingReader.reset(); } catch(_){} }
      if (this.rafId) cancelAnimationFrame(this.rafId);
      if (this.video){ try { this.video.pause(); } catch(_){} this.video.srcObject = null; }
      if (this.stream){ this.stream.getTracks().forEach(t=> t.stop()); this.stream = null; }
    }
  }

  class App {
    constructor(container){
      this.container = container;
      this.state = State.Idle;
      this.scanner = new Scanner((token)=> this.onToken(token));
      this.currentToken = null;
      this.liveRegion = null;
      this.repoBase = REPO_BASE_URL;
      this.render = this.render.bind(this);
    }

    setState(s){ this.state = s; this.render(); }

    announce(text){ if (this.liveRegion){ this.liveRegion.textContent = text; } }

    // Public: open the manual entry form programmatically
    openManual(){
      console.log('openManual called, current state:', this.state);
      // Ensure we're in idle state first
      this.setState(State.Idle);
      // Give the DOM a moment to update, then render manual
      setTimeout(() => {
        const card = this.container.querySelector('.taniwha-card');
        console.log('Looking for card:', card);
        if (card) {
          console.log('Card found, calling renderManual');
          this.renderManual(card);
        } else {
          console.log('Card not found!');
        }
      }, 50);
    }

    render(){
      this.container.innerHTML = '';
      const card = createEl('div', 'taniwha-card');
      const header = createEl('div', 'taniwha-header');
      const title = createEl('div', 'taniwha-title'); title.textContent = CONFIG.UI.title;
      const subtitle = createEl('div', 'taniwha-subtitle'); subtitle.textContent = CONFIG.UI.subtitle;
      header.appendChild(title); header.appendChild(subtitle);
      card.appendChild(header);

      const live = createEl('div', 'taniwha-sr-only');
      live.setAttribute('aria-live', 'polite');
      live.style.position='absolute'; live.style.left='-9999px';
      this.liveRegion = live;
      card.appendChild(live);

      if (this.state === State.Idle){ this.renderIdle(card); }
      else if (this.state === State.Scanning){ this.renderScanning(card); }
      else if (this.state === State.Validating){ this.renderValidating(card); }
      else if (this.state === State.Confirmed){ this.renderConfirmed(card); }
      else if (this.state === State.Denied){ this.renderDenied(card); }
      else { this.renderError(card); }

      this.container.appendChild(card);
    }

    renderIdle(card){
      const btnRow = createEl('div', 'taniwha-actions');
      const startBtn = createEl('button', 'taniwha-btn primary');
      startBtn.textContent = 'Start camera';
      startBtn.onclick = async ()=>{
        try {
          await this.scanner.start();
          this.setState(State.Scanning);
          this.announce('Camera started. Scanning.');
        } catch (err){
          this.announce('Camera unavailable.');
          this.renderFallback(card, err);
        }
      };
      const manualBtn = createEl('button', 'taniwha-btn'); manualBtn.textContent='Enter code instead'; manualBtn.onclick=()=> this.renderManual(card);
      if (CONFIG.ALLOW_FILE_UPLOAD_FALLBACK){
        const uploadBtn = createEl('button', 'taniwha-btn'); uploadBtn.textContent='Upload image'; uploadBtn.onclick=()=> this.renderUpload(card);
        btnRow.appendChild(uploadBtn);
      }
      btnRow.appendChild(startBtn);
      btnRow.appendChild(manualBtn);
      card.appendChild(btnRow);
    }

    renderScanning(card){
      const view = this.scanner.getView();
      card.appendChild(view);

      const actions = createEl('div', 'taniwha-actions');
      const stopBtn = createEl('button', 'taniwha-btn'); stopBtn.textContent = 'Stop'; stopBtn.onclick=()=> this.scanner.stop().then(()=> this.setState(State.Idle));
      const manualBtn = createEl('button', 'taniwha-btn'); manualBtn.textContent='Enter code instead'; manualBtn.onclick=()=>{ this.scanner.pause(); this.renderManual(card); };
      const uploadBtn = createEl('button', 'taniwha-btn'); uploadBtn.textContent='Upload image'; uploadBtn.onclick=()=>{ this.scanner.pause(); this.renderUpload(card); };
      actions.appendChild(stopBtn); actions.appendChild(manualBtn); if (CONFIG.ALLOW_FILE_UPLOAD_FALLBACK) actions.appendChild(uploadBtn);
      card.appendChild(actions);
    }

    renderValidating(card){
      const view = this.scanner.getView();
      card.appendChild(view);
      this.scanner.setStatus('Validating…', 'validating');
      const row = createEl('div', 'taniwha-result');
      row.innerHTML = '<span class="taniwha-inline"><span class="taniwha-spinner" aria-hidden="true"></span><span>Validating…</span></span>';
      card.appendChild(row);

      const actions = createEl('div', 'taniwha-actions');
      const cancelBtn = createEl('button', 'taniwha-btn'); cancelBtn.textContent='Cancel'; cancelBtn.onclick=()=>{ this.setState(State.Idle); this.scanner.stop(); };
      actions.appendChild(cancelBtn);
      card.appendChild(actions);
    }

    renderConfirmed(card){
      const row = createEl('div', 'taniwha-result confirmed taniwha-fade');
      const label = CONFIG.UI.confirmLabel || 'Confirmed';
      row.innerHTML = `<div class="taniwha-inline"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg><strong>${label}</strong></div>`;
      if (this.confirmData){
        const meta = createEl('div', 'taniwha-muted');
        const pieces = [];
        if (this.confirmData.name) pieces.push(this.confirmData.name);
        if (this.confirmData.email) pieces.push(maskEmail(this.confirmData.email));
        if (this.confirmData.meta && this.confirmData.meta.batch) pieces.push('Batch: '+this.confirmData.meta.batch);
        meta.textContent = pieces.join(' · ');
        row.appendChild(meta);
      }
      card.appendChild(row);

      const actions = createEl('div', 'taniwha-actions');
      const againBtn = createEl('button', 'taniwha-btn'); againBtn.textContent='Scan another'; againBtn.onclick=()=>{ this.setState(State.Scanning); this.scanner.resume(); };
      actions.appendChild(againBtn);
      card.appendChild(actions);
    }

    renderDenied(card){
      const row = createEl('div', 'taniwha-result denied taniwha-fade');
      const label = CONFIG.UI.denyLabel || 'Denied';
      const reason = (this.denyData && this.denyData.reason) ? (': ' + this.denyData.reason) : '';
      row.innerHTML = `<div class="taniwha-inline"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg><strong>${label}${reason}</strong></div>`;
      card.appendChild(row);

      const actions = createEl('div', 'taniwha-actions');
      const againBtn = createEl('button', 'taniwha-btn'); againBtn.textContent='Scan another'; againBtn.onclick=()=>{ this.setState(State.Scanning); this.scanner.resume(); };
      const manualBtn = createEl('button', 'taniwha-btn'); manualBtn.textContent='Enter code instead'; manualBtn.onclick=()=> this.renderManual(card);
      actions.appendChild(againBtn); actions.appendChild(manualBtn);
      card.appendChild(actions);
    }

    renderError(card){
      const row = createEl('div', 'taniwha-result error taniwha-fade');
      const label = CONFIG.UI.errorLabel || 'Something went wrong';
      row.innerHTML = `<div class="taniwha-inline"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg><strong>${label}</strong></div>`;
      if (this.errorText){ const meta=createEl('div','taniwha-muted'); meta.textContent=this.errorText; row.appendChild(meta); }
      card.appendChild(row);

      const actions = createEl('div', 'taniwha-actions');
      const retryBtn = createEl('button', 'taniwha-btn'); retryBtn.textContent=CONFIG.UI.retryLabel || 'Try again'; retryBtn.onclick=()=>{ this.errorText=''; this.setState(State.Scanning); this.scanner.resume(); };
      const manualBtn = createEl('button', 'taniwha-btn'); manualBtn.textContent='Enter code instead'; manualBtn.onclick=()=> this.renderManual(card);
      actions.appendChild(retryBtn); actions.appendChild(manualBtn);
      card.appendChild(actions);
    }

    renderFallback(card, err){
      const info = createEl('div', 'taniwha-muted');
      info.textContent = 'Camera blocked or not available.';
      card.appendChild(info);
      const actions = createEl('div', 'taniwha-actions');
      const manualBtn = createEl('button', 'taniwha-btn'); manualBtn.textContent='Enter code instead'; manualBtn.onclick=()=> this.renderManual(card);
      actions.appendChild(manualBtn);
      if (CONFIG.ALLOW_FILE_UPLOAD_FALLBACK){ const uploadBtn = createEl('button','taniwha-btn'); uploadBtn.textContent='Upload image'; uploadBtn.onclick=()=> this.renderUpload(card); actions.appendChild(uploadBtn); }
      card.appendChild(actions);
    }

    renderManual(card){
      console.log('renderManual called with card:', card);
      this.setState(State.Idle); // ensure scanning is stopped
      // Clear existing content first
      const existingActions = card.querySelector('.taniwha-actions');
      if (existingActions) {
        console.log('Removing existing actions');
        existingActions.remove();
      }
      
      const row = createEl('div', 'taniwha-row taniwha-actions');
      const input = createEl('input', 'taniwha-input taniwha-grow', { type: 'text', placeholder: 'Enter token (vch_...) or URL' });
      const submit = createEl('button', 'taniwha-btn primary'); 
      submit.textContent='Validate';
      submit.onclick = (e)=>{
        console.log('Validate button clicked!');
        const token = extractToken(input.value);
        if (!token){ this.errorText='Invalid token'; this.setState(State.Error); return; }
        this.validateToken(token);
      };
      row.appendChild(input); row.appendChild(submit);
      card.appendChild(row);
      
      console.log('Manual input added to card');
      
      // Focus the input for better UX
      setTimeout(() => {
        input.focus();
        console.log('Input focused');
      }, 100);
    }

    renderUpload(card){
      const row = createEl('div', 'taniwha-actions');
      const input = createEl('input', 'taniwha-input', { type:'file', accept:'image/png,image/jpeg' });
      const help = createEl('div', 'taniwha-muted'); help.textContent='Upload a photo or screenshot of the QR code.';
      input.onchange = async ()=>{
        const file = input.files && input.files[0]; if (!file) return;
        try { const token = await this.decodeImageFile(file); if (token) this.validateToken(token); else { this.errorText='No QR found in image.'; this.setState(State.Error); } }
        catch(err){ this.errorText='Could not decode image.'; this.setState(State.Error); }
      };
      row.appendChild(input); card.appendChild(row); card.appendChild(help);
    }

    async decodeImageFile(file){
      if ('BarcodeDetector' in window){
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const bitmap = await createImageBitmap(file);
        const codes = await detector.detect(bitmap);
        if (codes && codes.length){ const token = extractToken(codes[0].rawValue||''); if (token) return token; }
      }
      // fallback to ZXing via canvas
      const img = await new Promise((resolve, reject)=>{ const i=new Image(); i.onload=()=>resolve(i); i.onerror=reject; i.src=URL.createObjectURL(file); });
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const ZX = await loadZXing();
      const luminanceSource = new ZX.HTMLCanvasElementLuminanceSource(canvas);
      const binarizer = new ZX.CommonHybridBinarizer(luminanceSource);
      const bitmap = new ZX.BinaryBitmap(binarizer);
      try {
        const result = ZX.BrowserQRCodeReader ? ZX.BrowserQRCodeReader.prototype.decodeBitmap(bitmap) : ZX.MultiFormatReader.prototype.decode(bitmap);
      } catch(_){}
      try {
        const reader = new (ZX.BrowserQRCodeReader || ZX.BrowserMultiFormatReader)();
        const result = await reader.decodeFromImageElement(img);
        const text = result && (result.text || result.getText && result.getText());
        const token = extractToken(text||'');
        return token;
      } catch(err){ return null; }
    }

    async onToken(token){
      this.currentToken = token;
      this.setState(State.Validating);
      this.announce('Code detected. Validating.');
      try {
        const res = await postToMake(token);
        if (res && res.status === 'confirmed'){
          this.confirmData = res; this.setState(State.Confirmed);
        } else if (res && res.status === 'denied'){
          this.denyData = res; this.setState(State.Denied);
        } else {
          this.errorText = 'Unexpected response'; this.setState(State.Error);
        }
      } catch (err){
        this.errorText = (String(err && err.message || err) || 'Network error');
        this.setState(State.Error);
      }
    }

    async validateToken(token){
      this.currentToken = token; this.setState(State.Validating);
      try {
        const res = await postToMake(token);
        if (res && res.status === 'confirmed'){ this.confirmData = res; this.setState(State.Confirmed); }
        else if (res && res.status === 'denied'){ this.denyData = res; this.setState(State.Denied); }
        else { this.errorText='Unexpected response'; this.setState(State.Error); }
      } catch(err){ this.errorText=String(err && err.message || err); this.setState(State.Error); }
    }
  }

  function init(){
    const root = document.getElementById('taniwha-root');
    if (!root) return;
    mount(root);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();