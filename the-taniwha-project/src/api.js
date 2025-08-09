export async function postToMake(url, token, opts){
  const { mode = 'cors', timeoutMs = 8000 } = opts || {};
  const controller = new AbortController();
  const timer = setTimeout(()=> controller.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', mode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ts: Date.now(), ua: navigator.userAgent, source: 'taniwha-web' }), signal: controller.signal });
    if (!res.ok) throw new Error('bad_status_' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}