import https from 'node:https';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const MAX_ATTEMPTS = 5;
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is required.');
  process.exit(1);
}

/**
 * Call Gemini API with system instructions and user prompt.
 * Retries up to MAX_ATTEMPTS (5 total tries) on transient errors (503, 429, etc.)
 * with exponential backoff and jitter.
 */
export async function callGemini({ systemInstruction, prompt, temperature = 0.2 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json'
    }
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        const candidate = data.candidates?.[0];
        if (!candidate || !candidate.content?.parts?.[0]?.text) {
          throw new Error('Gemini API returned empty or invalid response candidate.');
        }

        const text = candidate.content.parts[0].text.trim();
        try {
          return JSON.parse(text);
        } catch (err) {
          // If wrapped in markdown blocks despite responseMimeType, strip it
          const cleanText = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
          return JSON.parse(cleanText);
        }
      }

      // Check if transient error eligible for retry
      const isRetryable = RETRYABLE_STATUS_CODES.includes(response.status);
      if (isRetryable && attempt < MAX_ATTEMPTS) {
        // Exponential backoff: ~2s, ~4s, ~8s, ~16s plus random jitter (0-1000ms)
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 1000);
        console.warn(
          `[Attempt ${attempt}/${MAX_ATTEMPTS}] Temporary Gemini API error (${response.status} ${response.statusText}). ` +
          `Retrying in ${Math.round(backoffMs / 1000)}s...`
        );
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      const errorBody = await response.text();
      throw new Error(`Gemini API error (${response.status} ${response.statusText}): ${errorBody}`);
    } catch (networkOrParseError) {
      // If network fetch failed or transient error, retry unless attempts exhausted
      if (attempt < MAX_ATTEMPTS && !networkOrParseError.message?.startsWith('Gemini API error (4')) {
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 1000);
        console.warn(
          `[Attempt ${attempt}/${MAX_ATTEMPTS}] Network or transient failure: ${networkOrParseError.message}. ` +
          `Retrying in ${Math.round(backoffMs / 1000)}s...`
        );
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      throw networkOrParseError;
    }
  }
}
