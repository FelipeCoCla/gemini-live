/**
 * Test asynchronous flow with Hermes via Cloudflare Tunnel
 */

import { dispatchToHermesAsync } from '../server/orchestrator.mjs';

console.log('Testing async dispatchToHermesAsync to https://hermes.bolidus.xyz...');

const immediateResult = dispatchToHermesAsync(
  {
    task: 'Hola Hermes, confirma si recibes este mensaje de prueba en una frase corta.',
    action_type: 'test_ping'
  },
  {
    onComplete: (reply) => {
      console.log('🎉 onComplete callback received from Hermes:', reply);
      process.exit(0);
    },
    onClarification: (question) => {
      console.log('❓ onClarification callback received:', question);
      process.exit(0);
    },
    onError: (err) => {
      console.error('❌ onError callback received:', err);
      process.exit(1);
    }
  }
);

console.log('⚡ Immediate Tool Acknowledgment:', immediateResult);
console.log('⏳ Waiting for Hermes background response...');
