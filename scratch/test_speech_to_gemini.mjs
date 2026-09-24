import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();
import { WebSocket } from 'ws';

const apiKey = process.env.GEMINI_API_KEY;
const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;

console.log('Connecting to Gemini Live with speech audio...');
const ws = new WebSocket(url);

// Read wav file and extract PCM samples (skip 44 bytes header)
const wavBuffer = fs.readFileSync('/tmp/speech.wav');
const pcmBuffer = wavBuffer.subarray(44);
console.log(`PCM audio size: ${pcmBuffer.length} bytes (~${(pcmBuffer.length / 32000).toFixed(2)} seconds of speech)`);

ws.on('open', () => {
  console.log('Connected! Sending setup configuration...');
  const setupMsg = {
    setup: {
      model: 'models/gemini-3.8-live',
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Aoede'
            }
          }
        }
      },
      systemInstruction: {
        parts: [
          {
            text: 'Eres un asistente conversacional útil y conciso. Responde por audio en español cuando el usuario te hable.'
          }
        ]
      }
    }
  };
  ws.send(JSON.stringify(setupMsg));
});

let audioResponseCount = 0;

ws.on('message', (data) => {
  const text = data.toString();
  try {
    const msg = JSON.parse(text);
    if (msg.setupComplete) {
      console.log('✅ Setup completed. Beginning streaming speech audio in 64ms chunks...');
      streamAudio();
    }
    if (msg.serverContent) {
      if (msg.serverContent.modelTurn) {
        audioResponseCount++;
        console.log(`🔊 [Gemini Voice Response] Part ${audioResponseCount}`);
      }
      if (msg.serverContent.outputTranscription) {
        console.log(`🗣️ [Gemini Transcript]: "${msg.serverContent.outputTranscription.text}"`);
      }
      if (msg.serverContent.turnComplete) {
        console.log('🎯 Turn completed!');
        setTimeout(() => {
          ws.close();
          process.exit(0);
        }, 2000);
      }
    }
  } catch (err) {
    console.log('Incoming message:', text.slice(0, 100));
  }
});

function streamAudio() {
  const chunkSize = 2048; // 1024 samples = 64ms at 16kHz
  let offset = 0;

  const interval = setInterval(() => {
    if (offset >= pcmBuffer.length) {
      clearInterval(interval);
      console.log('✅ Finished streaming speech audio. Sending turnComplete: true...');
      
      // Signal turn complete to trigger Gemini's answer
      ws.send(JSON.stringify({
        clientContent: {
          turnComplete: true
        }
      }));
      return;
    }

    const chunk = pcmBuffer.subarray(offset, Math.min(offset + chunkSize, pcmBuffer.length));
    const base64 = chunk.toString('base64');

    const msg = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64
          }
        ]
      }
    };
    ws.send(JSON.stringify(msg));
    offset += chunkSize;
  }, 64);
}

setTimeout(() => {
  console.log(`Timeout. Responses: ${audioResponseCount}`);
  ws.close();
  process.exit(0);
}, 25000);
