import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { callGemini } from './gemini-client.js';

async function main() {
  const issueNumber = process.env.ISSUE_NUMBER;
  let issueTitle = process.env.ISSUE_TITLE || '';
  let issueBody = process.env.ISSUE_BODY || '';
  let issueAuthor = process.env.ISSUE_AUTHOR || '';

  if (!issueNumber) {
    console.error('Error: ISSUE_NUMBER is required.');
    process.exit(1);
  }

  // If invoked via comment or workflow_dispatch, fetch latest details if title is blank
  if (!issueTitle) {
    try {
      const raw = execFileSync('gh', ['issue', 'view', issueNumber, '--json', 'title,body,author'], { encoding: 'utf8' });
      const data = JSON.parse(raw);
      issueTitle = data.title;
      issueBody = data.body || '';
      issueAuthor = data.author?.login || issueAuthor;
    } catch (e) {
      console.warn('Could not fetch issue details from gh CLI:', e.message);
    }
  }

  console.log(`Triaging issue #${issueNumber}: "${issueTitle}" by @${issueAuthor}`);

  const promptPath = path.resolve('.github/prompts/triage.md');
  const systemInstruction = fs.readFileSync(promptPath, 'utf8');

  // List repository files for high-level structure context
  const fileTree = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter(f => !f.startsWith('.git'))
    .join('\n');

  const userPrompt = `
Repository File Structure:
${fileTree}

New Issue Report:
Issue Number: #${issueNumber}
Author: @${issueAuthor}
Title: ${issueTitle}
Body:
${issueBody || '(No description provided)'}

Evaluate this issue against the rubric and output the triage JSON decision.
`;

  try {
    const result = await callGemini({ systemInstruction, prompt: userPrompt });
    console.log('Triage decision:', JSON.stringify(result, null, 2));

    const isReady = result.status === 'ready-for-fix';
    const targetLabel = isReady ? 'triage:ready-for-fix' : 'triage:needs-info';

    // Apply label using gh CLI
    try {
      execFileSync('gh', ['issue', 'edit', issueNumber, '--add-label', targetLabel]);
      console.log(`Applied label "${targetLabel}" to issue #${issueNumber}`);
    } catch (e) {
      console.warn(`Warning: Could not apply label via gh CLI: ${e.message}`);
    }

    // If more information is needed, post questions as a comment
    if (!isReady && Array.isArray(result.questions) && result.questions.length > 0) {
      const questionsFormatted = result.questions.map((q, idx) => `${idx + 1}. ${q}`).join('\n');
      const commentBody = `👋 Hello @${issueAuthor}! Thank you for opening this issue.

To help investigate and resolve this effectively, could you please provide a bit more information?

${questionsFormatted}

Once you reply with these details, our triage agent will re-evaluate and mark this ready for fixing! 🚀`;

      try {
        execFileSync('gh', ['issue', 'comment', issueNumber, '--body', commentBody]);
        console.log(`Posted clarifying questions to issue #${issueNumber}`);
      } catch (e) {
        console.warn(`Warning: Could not post comment via gh CLI: ${e.message}`);
      }
    } else if (isReady) {
      const commentBody = `✅ Issue triaged! Classified as **${result.classification || 'task'}** and verified ready for fix.
> **Summary:** ${result.summary || 'Ready for implementation.'}

The fix workflow has been queued.`;
      try {
        execFileSync('gh', ['issue', 'comment', issueNumber, '--body', commentBody]);
      } catch (e) {
        console.warn(`Warning: Could not post comment via gh CLI: ${e.message}`);
      }
    }
  } catch (err) {
    console.error('Triage agent failed:', err);
    process.exit(1);
  }
}

main();
