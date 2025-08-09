self.onmessage = async (e)=>{
  const { type } = e.data || {};
  if (type === 'ping') self.postMessage({ type: 'pong' });
};