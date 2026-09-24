import fs from 'fs';
import { execFileSync } from 'child_process';
import dotenv from 'dotenv';
dotenv.config();
import { WebSocket } from 'ws';

const apiKey = process.env.GEMINI_API_KEY;
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

const question = process.argv[2] || "¿Cuál es la capital de Francia?";
console.log('Testing question:', question);

// Generate pristine 16kHz WAV with say and extract PCM
const tmpWav = `/tmp/test_proto_${Date.now()}.wav`;
execFileSync('/usr/bin/say', ['-v', 'Mónica', '-o', tmpWav, '--data-format=LEI16@16000', question]);
const wavBuf = fs.readFileSync(tmpWav);
const dataIdx = wavBuf.indexOf(Buffer.from('data'));
const pcmBuf = dataIdx !== -1 ? wavBuf.subarray(dataIdx + 8) : wavBuf.subarray(44);
fs.unlinkSync(tmpWav);

console.log(`PCM Buffer: ${pcmBuf.length} bytes (~${(pcmBuf.length / 32000).toFixed(2)}s)`);

const ws = new WebSocket(url);

ws.on('open', () => {
  console.log('WS Connected. Sending setup...');
  ws.send(JSON.stringify({
    setup: {
      model: 'models/gemini-3.8-live',
      generationConfig: {
        responseModalities: ['AUDIO']
      }
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  
  if (msg.setupComplete) {
    console.log('Setup complete! Streaming audio with realtimeInput.audio...');
    streamAudio();
  }

  if (msg.serverContent) {
    if (msg.serverContent.outputTranscription) {
      process.stdout.write(msg.serverContent.outputTranscription.text || '');
    }
    if (msg.serverContent.turnComplete) {
      console.log('\n\n[Turn Complete]');
      ws.close();
      process.exit(0);
    }
  }
});

function streamAudio() {
  const chunkSize = 2048; // 64ms
  let offset = 0;

  const interval = setInterval(() => {
    if (offset >= pcmBuf.length) {
      clearInterval(interval);
      console.log('Audio finished. Sending audioStreamEnd: true and turnComplete: true...');
      
      ws.send(JSON.stringify({
        realtimeInput: {
          audioStreamEnd: true
        }
      }));

      ws.send(JSON.stringify({
        clientContent: {
          turnComplete: true
        }
      }));
      return;
    }

    const chunk = pcmBuf.subarray(offset, Math.min(offset + chunkSize, pcmBuf.length));
    ws.send(JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: chunk.toString('base64')
        }
      }
    }));
    offset += chunkSize;
  }, 64);
}

ws.on('error', (err) => console.error('WS Error:', err));
ws.on('close', (code, reason) => console.log('WS Closed:', code, reason.toString()));
