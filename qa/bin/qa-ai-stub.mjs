#!/usr/bin/env node
/**
 * A fake vision provider, and the reason the food-photo scenario can exist.
 *
 * The photo flow is the only feature in this app whose answer comes from a
 * third party, which makes it the only one a QA harness cannot assert against
 * without deciding what that third party said. A real provider would put three
 * things in the way at once: money, a network round trip, and a model that
 * returns different numbers for the same photograph every time — so an oracle
 * could only ever check that *something* plausible was written, which is
 * exactly the class of assertion this harness exists to avoid.
 *
 * So the provider is stubbed and nothing else is. The app, the estimate route,
 * the provider dispatch, the schema validation, the review form and the diary
 * write are all the real ones; only the model at the far end is replaced by a
 * constant (qa/fixtures/food-photo.mjs). The stub speaks the OpenAI
 * chat-completions shape because `service_type: 'custom'` posts to a
 * user-supplied URL verbatim, which is the one provider shape whose endpoint
 * the harness gets to choose.
 *
 * It also writes down every request it is given
 * (qa/run/ai-stub-requests.jsonl). That log is evidence no database row can
 * carry: it is the only place that shows the photograph was actually uploaded,
 * at its real dimensions, with the description and total weight the flow typed
 * into the Improve screen embedded in the prompt.
 */
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ESTIMATE } from '../fixtures/food-photo.mjs';

const port = Number(process.env.QA_AI_STUB_PORT);
const runDir = process.env.QA_RUN_DIR;
if (!Number.isInteger(port) || !runDir) {
  console.error('!! QA_AI_STUB_PORT and QA_RUN_DIR must be set — source qa/bin/qa-env.sh first.');
  process.exit(1);
}

const REQUEST_LOG = join(runDir, 'ai-stub-requests.jsonl');
// One base64 image can be several MB and the flow may send up to six.
const MAX_BODY_BYTES = 32 * 1024 * 1024;

mkdirSync(runDir, { recursive: true });

/**
 * Width and height straight out of the file header. The point is not the
 * numbers themselves but that they are read from the bytes that arrived: a
 * flow that picked the wrong library item, or an app that uploaded a thumbnail
 * instead of the asset, both write a perfectly valid row and are invisible
 * everywhere else.
 */
function imageSize(buf) {
  if (
    buf.length > 24 &&
    buf.readUInt32BE(0) === 0x89504e47 &&
    buf.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    // Walk the marker chain to the first start-of-frame, which is the only
    // place a JPEG records its dimensions. SOF0/1/2/3/5/6/7/9/10/11/13/14/15;
    // 0xc4, 0xc8 and 0xcc are Huffman/extension markers, not frames.
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1];
      const length = buf.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          width: buf.readUInt16BE(offset + 7),
          height: buf.readUInt16BE(offset + 5),
          format: 'jpeg',
        };
      }
      offset += 2 + length;
    }
    return { width: null, height: null, format: 'jpeg' };
  }
  return { width: null, height: null, format: 'unknown' };
}

function describeRequest(body) {
  const message = body?.messages?.[0];
  const content = message?.content;
  const parts = Array.isArray(content) ? content : [{ type: 'text', text: content }];
  const images = [];
  const texts = [];
  for (const part of parts) {
    if (part?.type === 'image_url') {
      // The dispatcher sends `data:<mime>;base64,<payload>`.
      const url = String(part.image_url?.url ?? '');
      const match = /^data:([^;]+);base64,(.*)$/s.exec(url);
      if (!match) {
        images.push({ mimeType: null, error: 'not a base64 data URL', urlPrefix: url.slice(0, 40) });
        continue;
      }
      const bytes = Buffer.from(match[2], 'base64');
      images.push({ mimeType: match[1], bytes: bytes.length, ...imageSize(bytes) });
    } else if (typeof part?.text === 'string') {
      texts.push(part.text);
    }
  }
  return { model: body?.model ?? null, prompt: texts.join('\n'), images };
}

function record(entry) {
  appendFileSync(REQUEST_LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('qa-ai-stub\n');
    return;
  }

  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    // Loudly, and in the log: a provider row pointing at the wrong path would
    // otherwise surface as a generic UPSTREAM_ERROR three layers up.
    record({ unexpected: `${req.method} ${req.url}` });
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `qa-ai-stub serves POST /v1/chat/completions, not ${req.method} ${req.url}` }));
    return;
  }

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      record({ error: `request body exceeded ${MAX_BODY_BYTES} bytes` });
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'body too large' }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      record({ error: `unparseable body: ${error.message}` });
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'body was not JSON' }));
      return;
    }

    record(describeRequest(body));

    // The OpenAI-family extractor reads choices[0].message.content and hands
    // the string to the food-photo schema, so the estimate is the content.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'qa-ai-stub',
        object: 'chat.completion',
        model: body?.model ?? 'qa-stub-vision',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: JSON.stringify(ESTIMATE) },
          },
        ],
      })
    );
  });
});

// Loopback only. This process answers anything that asks and would be a
// standing invitation on a shared network.
server.listen(port, '127.0.0.1', () => {
  console.log(`qa-ai-stub listening on http://127.0.0.1:${port} (log: ${REQUEST_LOG})`);
});
