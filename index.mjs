import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function promisifyExecFile(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

function spawnDetached(command, args, env, logPath) {
  const outFd = fs.openSync(logPath, 'a');
  const child = spawn(command, args, {
    env,
    detached: true,
    stdio: ['ignore', outFd, outFd]
  });
  child.unref();
  return { pid: child.pid };
}

function createTool(api) {
  const pluginConfig = api?.pluginConfig || {};

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const scriptPath = pluginConfig.scriptPath
    ? path.resolve(__dirname, String(pluginConfig.scriptPath))
    : path.resolve(__dirname, 'skills/linkedin-comment-connect/scripts/run_linkedin_comment_connect_hybrid.sh');

  const timeoutSec = Number(pluginConfig.timeoutSec ?? 1200);
  const defaultWebhookUrl = pluginConfig.defaultWebhookUrl || '';

  return {
    name: 'linkedin_comment_and_connect',
    label: 'LinkedIn Comment + Connect (Hybrid)',
    description:
      'Comment on a LinkedIn post using the logged-in noVNC Chromium container via CDP + OS-level xdotool click, then optionally send a connection request on a profile URL (skips company URLs).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['postUrl', 'commentText'],
      properties: {
        postUrl: { type: 'string', description: 'LinkedIn post URL.' },
        commentText: { type: 'string', description: 'Comment text to post (exact).' },
        profileUrl: { type: 'string', description: 'Optional LinkedIn profile URL to visit and attempt a Connect after commenting.' },
        webhookUrl: { type: 'string', description: 'Optional webhook callback URL override.' },
        async: { type: 'boolean', description: 'If true, return immediately after enqueueing the run (default: true).' },
        jobId: { type: 'string', description: 'Optional external job id for correlation (otherwise generated).' }
      }
    },

    async execute(_id, params) {
      try {
        const postUrl = String(params?.postUrl || '');
        const commentText = String(params?.commentText || '');
        const profileUrl = String(params?.profileUrl || '');
        const webhookUrl = String(params?.webhookUrl || defaultWebhookUrl || '');
        const isAsync = params?.async === undefined ? true : Boolean(params?.async);
        const jobId = (typeof params?.jobId === 'string' && params.jobId.trim()) ? params.jobId.trim() : randomUUID();

        if (!postUrl || !commentText) {
          return { ok: false, error: 'postUrl and commentText are required' };
        }

        // args: postUrl commentText [profileUrl] [webhookUrl]
        const runArgs = [postUrl, commentText];
        if (profileUrl) runArgs.push(profileUrl);
        if (webhookUrl) runArgs.push(webhookUrl);

        if (isAsync) {
          const logPath = `/tmp/openclaw/linkedin_comment_and_connect_${jobId}.log`;
          const { pid } = spawnDetached(scriptPath, runArgs, process.env, logPath);
          return {
            ok: true,
            accepted: true,
            async: true,
            jobId,
            pid,
            logPath,
            webhookUrl: webhookUrl || null
          };
        }

        const { error, stdout, stderr } = await promisifyExecFile(scriptPath, runArgs, {
          timeout: timeoutSec * 1000,
          maxBuffer: 10 * 1024 * 1024
        });

        if (error) {
          const msg = typeof error?.message === 'string' ? error.message : String(error);
          return {
            ok: false,
            error: `hybrid script failed: ${msg}`,
            stdout: String(stdout || ''),
            stderr: String(stderr || '')
          };
        }

        return {
          ok: true,
          accepted: true,
          async: false,
          jobId,
          stdout: String(stdout || ''),
          stderr: String(stderr || '')
        };
      } catch (e) {
        const msg = typeof e?.stack === 'string' ? e.stack : (typeof e?.message === 'string' ? e.message : String(e));
        return { ok: false, error: msg };
      }
    }
  };
}

export default function register(api) {
  const tool = createTool(api);
  api.registerTool(tool, { optional: false });
}
