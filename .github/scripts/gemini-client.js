import https from 'node:https';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is required.');
  process.exit(1);
}

/**
 * Call Gemini API with system instructions and user prompt.
 * Returns the parsed text response.
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status} ${response.statusText}): ${errorBody}`);
  }

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
