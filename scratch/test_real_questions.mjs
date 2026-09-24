import fs from 'fs';
import { WebSocket } from 'ws';

console.log('Testing Real Audio Questions through Gateway...');

const ws = new WebSocket('ws://localhost:3000/ws');

const q1Buffer = fs.readFileSync('/tmp/question1.wav').subarray(44);
const q2Buffer = fs.readFileSync('/tmp/question2.wav').subarray(44);

let currentTurn = 1;
let audioChunksThisTurn = 0;

ws.on('open', () => {
  console.log('✅ Connected to Gateway');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'state') {
    console.log(`[Gateway State]: ${msg.state}`, msg.metadata || '');
    if (msg.state === 'ready' && currentTurn === 1) {
      console.log('\n--- Turn 1: Sending Question 1 ("¿Cuál es la distancia entre la Tierra y la Luna?") ---');
      streamPcm(q1Buffer);
    } else if (msg.state === 'listening' && currentTurn === 1 && audioChunksThisTurn > 0) {
      console.log('✅ Question 1 answered! Waiting 2s before Question 2...');
      currentTurn = 2;
      setTimeout(() => {
        console.log('\n--- Turn 2: Sending Question 2 ("Hermes, revisa el estado del repositorio...") ---');
        streamPcm(q2Buffer);
      }, 2000);
    } else if (msg.state === 'listening' && currentTurn === 2 && audioChunksThisTurn > 0) {
      console.log('🎉 SUCCESS! Both questions tested successfully!');
      setTimeout(() => {
        ws.close();
        process.exit(0);
      }, 3000);
    }
  } else if (msg.type === 'audio') {
    audioChunksThisTurn++;
    if (audioChunksThisTurn === 1) {
      console.log(`🔊 [Turn ${currentTurn}] Gemini started streaming voice response!`);
    }
  } else if (msg.type === 'transcript') {
    console.log(`🗣️ [Turn ${currentTurn}] ${msg.role}: "${msg.text}"`);
  }
});

function streamPcm(pcmBuffer) {
  const chunkSize = 2048; // 1024 samples = 64ms
  let offset = 0;
  audioChunksThisTurn = 0;

  const interval = setInterval(() => {
    if (offset >= pcmBuffer.length) {
      clearInterval(interval);
      console.log(`Finished speech audio for Turn ${currentTurn}. Streaming silence for VAD trigger...`);
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
    if (count >= 15) { // ~1s silence
      clearInterval(silenceInterval);
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
