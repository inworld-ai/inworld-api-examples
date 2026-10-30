// Offline tests. No API key or network access is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
    SentenceBuffer, loadSystemPrompt, llmRequest, llmHeaders, parseSseLine, streamLlm, forwardReply,
    stripWavHeader, PROMPT_FILE,
} = require('./example_llm_steering_stream');
const { buildRequest, synthesize, synthesizeStream, describe, REASONING_CONTEXT } = require('./example_reasoning');

const REPLY = '[barely containing excitement like announcing a surprise] You did! First prize is yours. '
    + "Dr. Lee will call you... maybe tomorrow. [reset] I'll email you the details tonight.";
const pieces = (text, size) => Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size));
const balanced = (text) => text.split('[').length === text.split(']').length;
const quiet = { write: () => {} };

function runBuffer(tokens) {
    const buffer = new SentenceBuffer();
    const sentences = tokens.flatMap((t) => buffer.push(t));
    return { sentences, rest: buffer.flush() };
}

test('cuts sentences and keeps tags with their words', () => {
    const { sentences, rest } = runBuffer([REPLY]);
    assert.deepEqual(sentences, [
        '[barely containing excitement like announcing a surprise] You did! ',
        'First prize is yours. ',
        'Dr. Lee will call you... maybe tomorrow. ',
    ]);
    assert.equal(rest, "[reset] I'll email you the details tonight.");
});

test('a tag split across tokens is never cut', () => {
    for (let size = 1; size < 12; size++) {
        const { sentences, rest } = runBuffer(pieces(REPLY, size));
        assert.equal(sentences.join('') + rest, REPLY);
        for (const s of sentences) assert.ok(balanced(s), s);
    }
});

test('an unclosed tag holds back text', () => {
    const buffer = new SentenceBuffer();
    assert.deepEqual(buffer.push('Sure thing. [whisper'), ['Sure thing. ']);
    assert.deepEqual(buffer.push(" softly. Don't"), []);
    assert.deepEqual(buffer.push('] Keep it secret. '), ["[whisper softly. Don't] Keep it secret. "]);
});

test('a period inside a tag is not a sentence end', () => {
    const { sentences, rest } = runBuffer(['[say it slowly. like a secret] Hi there. ', 'Bye.']);
    assert.deepEqual(sentences, ['[say it slowly. like a secret] Hi there. ']);
    assert.equal(rest, 'Bye.');
});

test('CJK sentences end without a space', () => {
    const { sentences, rest } = runBuffer(['[gently] 你好。', '我们走吧！', '好']);
    assert.deepEqual(sentences, ['[gently] 你好。', '我们走吧！']);
    assert.equal(rest, '好');
});

test('system prompt ends with the shared prompt file', () => {
    const prompt = loadSystemPrompt('You are a pirate.');
    assert.ok(prompt.startsWith('You are a pirate.\n\n'));
    assert.ok(prompt.endsWith(fs.readFileSync(PROMPT_FILE, 'utf8').trim()));
    assert.deepEqual(llmRequest('Hi', prompt, 'some/model'), {
        model: 'some/model',
        stream: true,
        messages: [{ role: 'system', content: prompt }, { role: 'user', content: 'Hi' }],
    });
});

test('LLM auth defaults to the Inworld key', () => {
    assert.deepEqual(llmHeaders('abc', {}), { Authorization: 'Basic abc' });
    assert.deepEqual(llmHeaders('abc', { LLM_API_KEY: 'sk-1' }), { Authorization: 'Bearer sk-1' });
});

test('parses chat completions stream lines', () => {
    assert.equal(parseSseLine(`data: ${JSON.stringify({ choices: [{ delta: { content: '[sigh] Hi' } }] })}`), '[sigh] Hi');
    assert.equal(parseSseLine('data: [DONE]'), '');
    assert.equal(parseSseLine(': keep-alive'), '');
});

function bodyOf(text, size = 7) {
    const encoder = new TextEncoder();
    return (async function* () {
        for (const piece of pieces(text, size)) yield encoder.encode(piece);
    })();
}

test('streams LLM tokens from a fake response split mid-line', async () => {
    const sse = ['[sig', 'h] Hi', ' there.'].map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('')
        + 'data: [DONE]\n\n';
    let request;
    const fakeFetch = async (url, init) => {
        request = { url, init };
        return { ok: true, body: bodyOf(sse) };
    };
    const tokens = [];
    for await (const t of streamLlm('Hi', 'key', fakeFetch)) tokens.push(t);
    assert.deepEqual(tokens, ['[sig', 'h] Hi', ' there.']);
    assert.ok(request.url.endsWith('/chat/completions'));
    assert.equal(JSON.parse(request.init.body).messages[0].content, loadSystemPrompt());
});

test('forwards sentences with tags, then closes the context', async () => {
    const sent = [];
    async function* tokens() { yield* pieces(REPLY, 3); }
    await forwardReply(tokens(), (m) => sent.push(m), 'ctx', quiet);
    assert.deepEqual(sent[sent.length - 1], { contextId: 'ctx', closeContext: {} });
    const texts = sent.slice(0, -1).map((m) => m.sendText.text);
    assert.equal(texts.join(''), REPLY);
    assert.equal(texts.length, 4);
    for (const m of sent.slice(0, -1)) assert.deepEqual(m.sendText.flushContext, {});
    assert.ok(texts.every(balanced));
});

test('strips a WAV header', () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    assert.deepEqual(stripWavHeader(Buffer.concat([header, pcm])), pcm);
    assert.deepEqual(stripWavHeader(pcm), pcm);
});

const AUDIO = Buffer.from('mp3').toString('base64');

test('Reasoning request turns reasoning on with context', () => {
    const body = buildRequest('Hi.', { reasoningContext: 'A tense scene.', previousTexts: ['Did you hear that?'] });
    assert.equal(body.modelId, 'inworld-tts-2');
    assert.deepEqual(body.synthesisContext, {
        reasoning: 'REASONING_ON',
        reasoningContext: 'A tense scene.',
        previousRequests: [{ text: 'Did you hear that?' }],
    });
    assert.deepEqual(buildRequest('Hi.').synthesisContext, { reasoning: 'REASONING_ON' });
    assert.ok(REASONING_CONTEXT.length <= 600);
});

test('unary Reasoning returns the instruction and audio', async () => {
    let request;
    const fakeFetch = async (url, init) => {
        request = { url, init };
        return { ok: true, json: async () => ({ audioContent: AUDIO, reasoningInstruction: 'say it with dread' }) };
    };
    const result = await synthesize('key', { text: 'x' }, fakeFetch);
    assert.equal(result.instruction, 'say it with dread');
    assert.deepEqual(result.audio, Buffer.from('mp3'));
    assert.ok(request.url.endsWith('/tts/v1/voice'));
    assert.equal(request.init.headers.Authorization, 'Basic key');
});

test('streaming Reasoning reads the instruction from the first message', async () => {
    const lines = [
        JSON.stringify({ result: { audioContent: AUDIO, reasoningInstruction: 'hushed' } }),
        JSON.stringify({ result: { audioContent: AUDIO } }),
    ].join('\n');
    let url;
    const fakeFetch = async (u) => { url = u; return { ok: true, body: bodyOf(lines, 5) }; };
    const result = await synthesizeStream('key', { text: 'x' }, fakeFetch);
    assert.equal(result.instruction, 'hushed');
    assert.deepEqual(result.audio, Buffer.from('mp3mp3'));
    assert.ok(url.endsWith('/tts/v1/voice:stream'));
});

test('an HTTP error is thrown', async () => {
    const fakeFetch = async () => ({ ok: false, status: 400, text: async () => 'bad' });
    await assert.rejects(synthesize('key', {}, fakeFetch), /HTTP 400/);
});

test('describe suggests the inline tag to keep a delivery', () => {
    assert.match(describe('hushed', 'Hi.'), /\[hushed\] Hi\./);
    assert.match(describe('', 'Hi.'), /no instruction/);
});
