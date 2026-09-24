#!/usr/bin/env node
/**
 * CLI Voice Query Tool (Night / Silent Mode)
 * Sends exact user query to Gateway over WebSocket,
 * prints transcript in real-time, and plays Gemini's vocal response via `afplay` in your headphones.
 *
 * Usage:
 *   node scratch/ask.mjs "Hola Gemini, que dia es hoy"
 *   node scratch/ask.mjs "Hermes, revisa el estado de git"
 */

import fs from 'fs';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';

const prompt = process.argv.slice(2).join(' ').trim() || 'Hola Gemini, que dia es hoy';
console.log(`\n🌙 [Modo Silencioso / Terminal] Preguntando a Gemini:`);
console.log(`💬 "${prompt}"\n`);

const ws = new WebSocket('ws://localhost:3000/ws');
const audioChunks = [];
let answerStarted = false;

ws.on('open', () => {
  console.log('🔗 Conectado al Gateway WebSocket.');
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'state') {
      if (msg.state === 'ready') {
        console.log('⚡ Sesión lista. Enviando consulta a Gemini...');
        console.log('🗣️ Respuesta de Gemini:\n');
        ws.send(JSON.stringify({
          type: 'user_text',
          text: prompt
        }));
      }
    } else if (msg.type === 'transcript') {
      if (msg.role === 'model') {
        answerStarted = true;
        process.stdout.write(msg.text);
      }
    } else if (msg.type === 'audio' && msg.data) {
      const chunkBuf = Buffer.from(msg.data, 'base64');
      audioChunks.push(chunkBuf);
    }
  } catch (err) {}
});

// Watch for turn completion and playback
let silenceTimer = null;
const checkInterval = setInterval(() => {
  if (audioChunks.length > 0 && !silenceTimer) {
    silenceTimer = setTimeout(() => {
      clearInterval(checkInterval);
      playResponse();
    }, 2200);
  }
}, 250);

function playResponse() {
  if (audioChunks.length === 0) {
    console.log('\n(No se recibió audio de respuesta)');
    ws.close();
    process.exit(0);
    return;
  }

  console.log('\n\n🔊 Reproduciendo respuesta de voz de Gemini en tus audífonos/parlantes (afplay)...');
  const fullPcm = Buffer.concat(audioChunks);
  const outWav = `/tmp/gemini_response_${Date.now()}.wav`;
  
  // Write 24kHz Mono 16-bit WAV
  const wavHeader = createWavHeader(fullPcm.length, 24000, 1, 16);
  fs.writeFileSync(outWav, Buffer.concat([wavHeader, fullPcm]));

  const player = spawn('/usr/bin/afplay', [outWav]);
  player.on('close', () => {
    try { fs.unlinkSync(outWav); } catch (e) {}
    ws.close();
    console.log('✨ Reproducción finalizada.\n');
    process.exit(0);
  });
}

function createWavHeader(dataLength, sampleRate = 24000, channels = 1, bitDepth = 16) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}
