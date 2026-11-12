import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { callGemini } from './gemini-client.js';

async function main() {
  const issueNumber = process.env.ISSUE_NUMBER;
  const commentAuthor = process.env.COMMENT_AUTHOR;
  const commentBody = process.env.COMMENT_BODY;

  if (!issueNumber) {
    console.error('Error: ISSUE_NUMBER is required.');
    process.exit(1);
  }

  // Loop guard: ignore comments from github-actions[bot] or similar automation
  if (commentAuthor?.includes('[bot]') || commentAuthor === 'github-actions') {
    console.log(`Skipping bot comment from ${commentAuthor}.`);
    return;
  }

  // Check if issue currently has triage:needs-info label
  let issueData;
  try {
    const raw = execFileSync('gh', ['issue', 'view', issueNumber, '--json', 'labels,title,body,comments'], { encoding: 'utf8' });
    issueData = JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to fetch issue #${issueNumber}:`, e.message);
    process.exit(1);
  }

  const hasNeedsInfo = issueData.labels?.some(l => l.name === 'triage:needs-info');
  if (!hasNeedsInfo) {
    console.log(`Issue #${issueNumber} does not have triage:needs-info. Skipping clarification.`);
    return;
  }

  console.log(`Clarification agent analyzing issue #${issueNumber} following comment by @${commentAuthor}`);

  const promptPath = path.resolve('.github/prompts/discussion.md');
  const systemInstruction = fs.readFileSync(promptPath, 'utf8');

  // Format comments thread
  const thread = (issueData.comments || []).map(c => `[${c.author.login}]: ${c.body}`).join('\n\n---\n\n');

  const userPrompt = `
Issue #${issueNumber}: ${issueData.title}
Original Description:
${issueData.body}

Conversation Thread:
${thread}

Latest Comment by @${commentAuthor}:
${commentBody}

Evaluate if the issue is now complete and actionable or if more info is needed.
`;

  try {
    const result = await callGemini({ systemInstruction, prompt: userPrompt });
    console.log('Discussion decision:', JSON.stringify(result, null, 2));

    if (result.status === 'ready-for-fix') {
      // Swap label: remove triage:needs-info and add triage:ready-for-fix
      try {
        execFileSync('gh', ['issue', 'edit', issueNumber, '--remove-label', 'triage:needs-info', '--add-label', 'triage:ready-for-fix']);
        console.log(`Swapped labels on #${issueNumber} to triage:ready-for-fix`);
      } catch (e) {
        console.warn('Could not update labels:', e.message);
      }

      const reply = result.follow_up_comment || `🎉 Thank you @${commentAuthor}! The details provided clarify the requirements. Marking this issue as ready for fix!`;
      try {
        execFileSync('gh', ['issue', 'comment', issueNumber, '--body', reply]);
      } catch (e) {
        console.warn('Could not post comment:', e.message);
      }
    } else {
      // Still needs info
      if (result.follow_up_comment) {
        try {
          execFileSync('gh', ['issue', 'comment', issueNumber, '--body', result.follow_up_comment]);
        } catch (e) {
          console.warn('Could not post follow-up comment:', e.message);
        }
      }
    }
  } catch (err) {
    console.error('Clarification agent failed:', err);
    process.exit(1);
  }
}

main();
