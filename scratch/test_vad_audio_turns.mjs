import fs from 'fs';
import { WebSocket } from 'ws';

console.log('Testing Audio VAD Turn 1 and Turn 2 via Gateway...');

const ws = new WebSocket('ws://localhost:4040/ws');
const wavBuffer = fs.readFileSync('/tmp/speech.wav');
const pcmBuffer = wavBuffer.subarray(44);

let currentTurn = 1;
let audioChunksThisTurn = 0;
let isSpeaking = false;

ws.on('open', () => {
  console.log('✅ Connected to Gateway WebSocket');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'state') {
    console.log(`[Gateway State]: ${msg.state}`, msg.metadata || '');
    if (msg.state === 'ready' && currentTurn === 1) {
      console.log('\n--- Turn 1: Sending Speech Audio ---');
      streamAudioChunkByChunk();
    } else if (msg.state === 'listening' && currentTurn === 1 && audioChunksThisTurn > 0) {
      console.log('✅ Turn 1 finished cleanly! Now sending Turn 2 audio after 1.5s...');
      currentTurn = 2;
      setTimeout(() => {
        console.log('\n--- Turn 2: Sending Follow-up Speech Audio ---');
        streamAudioChunkByChunk();
      }, 1500);
    } else if (msg.state === 'listening' && currentTurn === 2 && audioChunksThisTurn > 0) {
      console.log('🎉 SUCCESS! Both Turn 1 and Turn 2 completed successfully!');
      setTimeout(() => {
        ws.close();
        process.exit(0);
      }, 2000);
    }
  } else if (msg.type === 'audio') {
    audioChunksThisTurn++;
    if (audioChunksThisTurn === 1) {
      console.log(`🔊 [Turn ${currentTurn}] Gemini started speaking voice audio!`);
    }
  } else if (msg.type === 'transcript') {
    console.log(`🗣️ [Turn ${currentTurn}] ${msg.role}: "${msg.text}"`);
  }
});

function streamAudioChunkByChunk() {
  const chunkSize = 2048; // 1024 samples = 64ms
  let offset = 0;
  audioChunksThisTurn = 0;

  const interval = setInterval(() => {
    if (offset >= pcmBuffer.length) {
      clearInterval(interval);
      console.log(`Finished speech audio for Turn ${currentTurn}. Streaming 800ms of silence for VAD trigger...`);
      streamSilence();
      return;
    }

    const chunk = pcmBuffer.subarray(offset, Math.min(offset + chunkSize, pcmBuffer.length));
    ws.send(JSON.stringify({
      type: 'audio',
      data: chunk.toString('base64')
    }));
    offset += chunkSize;
  }, 64);
}

function streamSilence() {
  let count = 0;
  const silenceInterval = setInterval(() => {
    if (count >= 15) { // ~1 second silence
      clearInterval(silenceInterval);
      console.log('Silence sent. Waiting for Gemini response...');
      return;
    }
    const silentChunk = new Int16Array(1024);
    ws.send(JSON.stringify({
      type: 'audio',
      data: Buffer.from(silentChunk.buffer).toString('base64')
    }));
    count++;
  }, 64);
}
