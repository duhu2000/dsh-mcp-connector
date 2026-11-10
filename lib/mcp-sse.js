/** Read the first complete SSE event matching a JSON-RPC request, without waiting for EOF. */
export async function readSseResponse(response, { id, maxBytes, tooLarge }) {
  if (!response.body) return { text: '', payload: undefined };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let line = '';
  let data = [];
  let skipLF = false;
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      // EOF does not dispatch an event lacking its final blank line.
      if (done) return { text: '', payload: undefined };
      total += value.byteLength;
      if (total > maxBytes) throw tooLarge();
      const text = decoder.decode(value, { stream: true });
      if (!text) continue;
      let start = skipLF && text.startsWith('\n') ? 1 : 0;
      skipLF = text.endsWith('\r');
      const endings = /\r\n|\r|\n/g;
      endings.lastIndex = start;
      let ending;
      while ((ending = endings.exec(text))) {
        line += text.slice(start, ending.index);
        start = endings.lastIndex;
        if (line === '') {
          const event = data.join('\n');
          data = [];
          let payload;
          try { payload = JSON.parse(event); } catch { continue; }
          if (payload?.jsonrpc === '2.0' && payload.id === id && ('result' in payload || 'error' in payload)) {
            return { text: event, payload };
          }
        } else {
          if (line === 'data') data.push('');
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          line = '';
        }
      }
      line += text.slice(start);
    }
  } finally {
    // A server or stream adapter may never resolve cancellation; do not await it.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
