import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { callGemini } from './gemini-client.js';
import { AGENT_CONFIG, getAgentGitTrailer } from './agent-config.js';

async function main() {
  const issueNumber = process.env.ISSUE_NUMBER;
  const isPR = process.env.IS_PR === 'true';
  const commentBody = process.env.COMMENT_BODY || '';
  const commentAuthor = process.env.COMMENT_AUTHOR || '';

  if (!issueNumber) {
    console.error('Error: ISSUE_NUMBER is required.');
    process.exit(1);
  }

  console.log(`Starting ${isPR ? 'PR revision' : 'fix'} workflow for #${issueNumber}`);

  let itemData;
  let branchName;

  if (isPR) {
    try {
      const raw = execFileSync('gh', ['pr', 'view', issueNumber, '--json', 'title,body,comments,reviews,headRefName'], { encoding: 'utf8' });
      itemData = JSON.parse(raw);
      branchName = itemData.headRefName;
    } catch (e) {
      console.error(`Failed to fetch PR #${issueNumber}:`, e.message);
      process.exit(1);
    }
  } else {
    try {
      const raw = execFileSync('gh', ['issue', 'view', issueNumber, '--json', 'title,body,comments,labels'], { encoding: 'utf8' });
      itemData = JSON.parse(raw);
      branchName = `fix/issue-${issueNumber}`;
    } catch (e) {
      console.error(`Failed to fetch issue #${issueNumber}:`, e.message);
      process.exit(1);
    }
  }

  // Check out existing branch if revising PR, or create/reset branch if new fix
  if (isPR) {
    console.log(`Checking out existing PR branch: ${branchName}`);
    execFileSync('git', ['fetch', 'origin', branchName]);
    execFileSync('git', ['checkout', branchName]);
    execFileSync('git', ['pull', 'origin', branchName]);
  } else {
    console.log(`Creating branch: ${branchName}`);
    execFileSync('git', ['checkout', '-B', branchName]);
  }

  const promptPath = path.resolve('.github/prompts/fix.md');
  const systemInstruction = fs.readFileSync(promptPath, 'utf8');

  // Collect key files for context
  const filesToInclude = [
    'package.json',
    'index.html',
    'css/style.css',
    'js/version.js',
    'js/mm2-specs.js',
    'js/sysex-parser.js',
    'js/patch-librarian.js',
    'js/midi-manager.js',
    'js/ui-controls.js',
    'js/app.js'
  ];

  let codebaseContext = '';
  for (const relPath of filesToInclude) {
    if (fs.existsSync(relPath)) {
      const content = fs.readFileSync(relPath, 'utf8');
      codebaseContext += `\n\n=== File: ${relPath} ===\n${content}\n`;
    }
  }

  const thread = (itemData.comments || []).map(c => `[${c.author?.login || 'user'}]: ${c.body}`).join('\n\n---\n\n');

  let userPrompt = '';
  if (isPR) {
    userPrompt = `
PR Revision Request: PR #${issueNumber}: "${itemData.title}"
Branch: ${branchName}

Original PR Description:
${itemData.body}

Review Discussion Thread:
${thread}

Latest Review Feedback from @${commentAuthor}:
${commentBody}

Key Source Files (Current State on branch):
${codebaseContext}

Carefully review the requested feedback from the reviewer.
Update only the necessary code files to implement the requested revision.
Ensure all existing code that is unaffected remains unchanged.
`;
  } else {
    userPrompt = `
Issue #${issueNumber}: ${itemData.title}

Issue Description:
${itemData.body}

Discussion Thread:
${thread}

Key Source Files:
${codebaseContext}

Analyze the problem, formulate the solution, and generate the JSON payload containing the files to modify/create and PR details.
`;
  }

  try {
    const result = await callGemini({
      systemInstruction,
      prompt: userPrompt,
      temperature: 0.1
    });

    console.log('Fix/revision proposal received:', result.pr_title || 'Revision received');

    if (!Array.isArray(result.files) || result.files.length === 0) {
      throw new Error('Gemini proposed no file modifications.');
    }

    // Configure git user to reflect Gemini AI authorship
    execFileSync('git', ['config', 'user.name', AGENT_CONFIG.name]);
    execFileSync('git', ['config', 'user.email', AGENT_CONFIG.email]);

    // Apply file changes
    for (const f of result.files) {
      const targetPath = path.resolve(f.path);
      // Security check: ensure path is inside repo
      if (!targetPath.startsWith(process.cwd())) {
        console.warn(`Skipping invalid path outside repo: ${f.path}`);
        continue;
      }

      if (f.action === 'delete') {
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
          console.log(`Deleted: ${f.path}`);
        }
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, f.content, 'utf8');
        console.log(`Updated/Created: ${f.path}`);
      }
    }

    // Run test suite
    console.log('Running test suite (npm test)...');
    try {
      execFileSync('npm', ['test'], { stdio: 'inherit' });
      console.log('Tests passed successfully!');
    } catch (testErr) {
      console.error('Tests failed after applying fix/revision!');
      const targetEntity = isPR ? 'pr' : 'issue';
      try {
        if (!isPR) {
          execFileSync('gh', ['issue', 'edit', issueNumber, '--add-label', AGENT_CONFIG.labels.fixFailed]);
        }
        execFileSync('gh', [targetEntity, 'comment', issueNumber, '--body', '⚠️ Agent attempted changes but tests failed. Human review requested.']);
      } catch (e) {}
      process.exit(1);
    }

    // Commit changes
    execFileSync('git', ['add', '-A']);
    const commitMsg = isPR
      ? `fix: address review feedback\n\n${commentBody ? `Feedback addressed: ${commentBody.slice(0, 100)}\n\n` : ''}${getAgentGitTrailer()}`
      : (result.commit_message || `fix: resolve issue #${issueNumber}\n\n${getAgentGitTrailer()}`);

    execFileSync('git', ['commit', '-m', commitMsg]);

    // Push branch
    execFileSync('git', ['push', 'origin', branchName]);
    console.log(`Pushed changes to branch ${branchName}`);

    if (isPR) {
      // PR is already open; comment confirming revision
      const replyBody = `✅ Pushed revision to \`${branchName}\` addressing review feedback:\n\n> ${commentBody}\n\nAll automated tests passed!`;
      try {
        execFileSync('gh', ['pr', 'comment', issueNumber, '--body', replyBody]);
      } catch (e) {
        console.warn('Could not post confirmation comment to PR:', e.message);
      }
      console.log(`Updated PR #${issueNumber} with revision.`);
    } else {
      // Create Pull Request
      const prTitle = result.pr_title || `fix: address issue #${issueNumber}`;
      const prBody = `${result.pr_description || ''}\n\nCloses #${issueNumber}\n\n*Automated PR generated by Gemini Fix Agent*`;

      execFileSync('gh', [
        'pr',
        'create',
        '--base', 'main',
        '--head', branchName,
        '--title', prTitle,
        '--body', prBody
      ]);

      console.log(`Created PR for issue #${issueNumber}`);
    }
  } catch (err) {
    console.error('Fix/revision agent failed:', err);
    process.exit(1);
  }
}

main();
