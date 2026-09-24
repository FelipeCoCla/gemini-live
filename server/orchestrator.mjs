/**
 * Hermes Orchestrator Bridge (via Cloudflare Tunnel)
 * Manages async communication with Hermes agent in Felipe's bunker.
 */

const HERMES_API_URL = process.env.HERMES_API_URL || 'https://hermes.bolidus.xyz/v1/chat/completions';
const HERMES_API_KEY = process.env.HERMES_API_KEY || 'hermes-felipe-bunker';
const HERMES_MODEL = process.env.HERMES_MODEL || 'hermes-agent';

/**
 * Dispatches a technical task to the Hermes orchestrator asynchronously.
 * Returns an immediate acknowledgment so Gemini can speak its confirmation right away,
 * while Hermes processes in the background.
 *
 * @param {Object} params - { task, action_type, details }
 * @param {Object} handlers - { onComplete, onClarification, onError }
 */
export function dispatchToHermesAsync({ task, action_type, details }, { onComplete, onClarification, onError }) {
  console.log(`[Orchestrator] 🚀 Dispatched async task to Hermes: [${action_type}] "${task}"`);

  const payload = {
    model: HERMES_MODEL,
    messages: [
      {
        role: 'system',
        content: `Eres Hermes, el orquestador técnico central del bunker de Felipe. Ejecutas tareas técnicas, análisis de código, operaciones de infraestructura y comandos. Responde en español de forma directa, inteligente y ejecutiva. Si necesitas que Felipe elija una opción o confirme un dato antes de continuar, indícalo al inicio con el prefijo [CLARIFICATION_NEEDED].`
      },
      {
        role: 'user',
        content: `Tarea técnica de Felipe: "${task}"\nTipo de acción: ${action_type}\nDetalles: ${JSON.stringify(details || {})}`
      }
    ]
  };

  // Run in background without blocking Gemini's immediate voice response
  (async () => {
    try {
      const controller = new AbortController();
      // Allow up to 90 seconds for local bunker inference
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      const response = await fetch(HERMES_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${HERMES_API_KEY}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content || 'Tarea procesada por Hermes.';
        console.log(`[Orchestrator] ✅ Hermes completed task: "${reply.slice(0, 120)}..."`);

        if (reply.includes('[CLARIFICATION_NEEDED]') && onClarification) {
          const question = reply.replace('[CLARIFICATION_NEEDED]', '').trim();
          onClarification(question);
        } else if (onComplete) {
          onComplete(reply.trim());
        }
      } else {
        const errText = await response.text();
        console.error(`[Orchestrator] ❌ Hermes HTTP error ${response.status}: ${errText}`);
        if (onError) onError(`Hermes respondió con error (${response.status})`);
      }
    } catch (err) {
      console.error(`[Orchestrator] ❌ Connection error with Hermes bunker:`, err.message);
      if (onError) onError(`No se pudo conectar con el bunker de Hermes: ${err.message}`);
    }
  })();

  // Return immediate response for the tool call
  return {
    status: 'dispatched',
    message: `Instrucción enviada a Hermes correctamente. Tarea en proceso: ${task}`,
    action_type
  };
}
