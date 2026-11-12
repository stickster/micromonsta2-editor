import https from 'node:https';
import { AGENT_CONFIG } from './agent-config.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = AGENT_CONFIG.model;
const MAX_ATTEMPTS = AGENT_CONFIG.maxAttempts;
const RETRYABLE_STATUS_CODES = AGENT_CONFIG.retryableStatusCodes;

if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is required.');
  process.exit(1);
}

/**
 * Sanitize raw LLM response text that may contain invalid JSON escape sequences
 * (e.g., unescaped backslashes in code snippets like regexes \s, \d, or paths \a).
 */
function safeJsonParse(rawText) {
  let text = rawText.trim();
  // Strip code fences if present
  text = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();

  try {
    return JSON.parse(text);
  } catch (initialErr) {
    // If syntax error due to bad escaped characters, sanitize invalid escape sequences
    // Valid JSON escape sequences are: \", \\, \/, \b, \f, \n, \r, \t, or \uXXXX
    const sanitized = text.replace(/\\([^"\\\/bfnrtu])/g, (match, ch) => {
      return '\\\\' + ch;
    });

    try {
      return JSON.parse(sanitized);
    } catch (secondErr) {
      console.error('Failed to parse JSON even after escape sequence sanitization.');
      console.error('Initial parse error:', initialErr.message);
      throw initialErr;
    }
  }
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

        return safeJsonParse(candidate.content.parts[0].text);
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
    } catch (networkError) {
      if (attempt < MAX_ATTEMPTS && !networkError.message?.startsWith('Gemini API error (4')) {
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 1000);
        console.warn(
          `[Attempt ${attempt}/${MAX_ATTEMPTS}] Network or transient failure: ${networkError.message}. ` +
          `Retrying in ${Math.round(backoffMs / 1000)}s...`
        );
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      throw networkError;
    }
  }
}
