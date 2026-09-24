import fs from 'fs';

console.log('Testing VAD End-to-End through Gateway...');

const ws = new WebSocket('ws://localhost:4040/ws');
const wavBuffer = fs.readFileSync('/tmp/speech.wav');
const pcmBuffer = wavBuffer.subarray(44);

let geminiAudioChunks = 0;

ws.addEventListener('open', () => {
  console.log('✅ Client connected to Gateway');
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'state') {
    console.log('Gateway state:', msg.state);
    if (msg.state === 'ready') {
      console.log('Session ready! Streaming speech audio through Gateway...');
      streamSpeechThenSilence();
    }
  } else if (msg.type === 'audio') {
    geminiAudioChunks++;
    if (geminiAudioChunks === 1) {
      console.log('🎉 SUCCESS! Gemini responded with voice audio over Gateway!');
      setTimeout(() => {
        ws.close();
        process.exit(0);
      }, 3000);
    }
  }
});

function streamSpeechThenSilence() {
  const chunkSize = 2048; // 1024 samples = 64ms
  let offset = 0;

  // 1. Stream speech audio
  const speechInterval = setInterval(() => {
    if (offset >= pcmBuffer.length) {
      clearInterval(speechInterval);
      console.log('Finished speech audio. Now streaming silence to test VAD auto-trigger...');
      streamSilence();
      return;
    }

    const chunk = pcmBuffer.subarray(offset, Math.min(offset + chunkSize, pcmBuffer.length));
    const base64 = chunk.toString('base64');
    ws.send(JSON.stringify({ type: 'audio', data: base64 }));
    offset += chunkSize;
  }, 64);
}

function streamSilence() {
  // Send 15 chunks (~1 second) of silence
  let silenceCount = 0;
  const silenceInterval = setInterval(() => {
    if (silenceCount >= 15) {
      clearInterval(silenceInterval);
      console.log('Silence period finished. Waiting for Gemini response...');
      return;
    }

    const silentChunk = new Int16Array(1024); // all zeros
    const base64 = Buffer.from(silentChunk.buffer).toString('base64');
    ws.send(JSON.stringify({ type: 'audio', data: base64 }));
    silenceCount++;
  }, 64);
}

setTimeout(() => {
  console.log(`Test timeout. Audio chunks received from Gemini: ${geminiAudioChunks}`);
  ws.close();
  process.exit(geminiAudioChunks > 0 ? 0 : 1);
}, 20000);
