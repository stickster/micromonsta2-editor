/**
 * Central configuration for Gemini AI GitHub Actions agents.
 */
export const AGENT_CONFIG = {
  name: 'Google Gemini',
  email: 'gemini@google.com',
  model: process.env.GEMINI_MODEL || 'gemini-3.7-flash-lite',
  maxAttempts: 5,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  labels: {
    needsInfo: 'triage:needs-info',
    readyForFix: 'triage:ready-for-fix',
    fixFailed: 'agent:fix-failed'
  }
};

/**
 * Check whether a username belongs to bot automation to prevent feedback loops.
 */
export function isBotUser(username) {
  if (!username) return false;
  return username.includes('[bot]') || username === 'github-actions' || username === AGENT_CONFIG.name;
}

/**
 * Returns standard Co-authored-by git trailer line.
 */
export function getAgentGitTrailer() {
  return `Co-authored-by: ${AGENT_CONFIG.name} <${AGENT_CONFIG.email}>`;
}
