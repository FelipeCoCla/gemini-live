/**
 * Test Gateway Audio Streaming from a client
 */

const ws = new WebSocket('ws://localhost:4040/ws');

ws.addEventListener('open', () => {
  console.log('✅ Client connected to ws://localhost:4040/ws');
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'state') {
    console.log('State from gateway:', msg.state);
    if (msg.state === 'ready') {
      console.log('Session ready! Sending 30 audio chunks (16kHz PCM)...');
      
      let sent = 0;
      const timer = setInterval(() => {
        if (sent >= 30) {
          clearInterval(timer);
          console.log('Finished streaming audio. Waiting for response...');
          return;
        }

        const pcm = new Int16Array(1024);
        for (let i = 0; i < 1024; i++) {
          pcm[i] = Math.round(Math.sin(2 * Math.PI * 440 * (i / 16000)) * 5000);
        }
        const base64 = Buffer.from(pcm.buffer).toString('base64');
        ws.send(JSON.stringify({ type: 'audio', data: base64 }));
        sent++;
      }, 64);
    }
  } else if (msg.type === 'audio') {
    console.log('🎉 Received audio from Gemini Live! Bytes:', msg.data.length);
    ws.close();
    process.exit(0);
  }
});

ws.addEventListener('error', (err) => console.error('WS Error:', err));
ws.addEventListener('close', (e) => console.log('WS Closed:', e.code));

setTimeout(() => {
  console.log('Timeout');
  ws.close();
  process.exit(0);
}, 10000);
