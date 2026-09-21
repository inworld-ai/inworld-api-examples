const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const name of ['websocket', 'with_vad_config', 'with_voice_profile', 'mic']) {
    const modes = ['success', 'timeout', 'error', 'partial'];
    if (name === 'mic') modes.push('mic-exit', 'mic-failure');
    for (const mode of modes) {
        test(`${name}: ${mode}`, { timeout: 1000 }, async () => {
            const frames = [];
            const logs = [];
            const signals = new EventEmitter();
            const mic = new EventEmitter();
            mic.stdout = new EventEmitter();
            mic.stderr = new EventEmitter();
            let micClosed = false;
            mic.kill = () => {
                if (micClosed) return false;
                setImmediate(() => {
                    micClosed = true;
                    mic.stdout.emit('data', Buffer.alloc(2));
                    mic.emit('exit', null, 'SIGTERM');
                    mic.emit('close', null, 'SIGTERM');
                });
            };
            class Socket extends EventEmitter {
                static OPEN = 1;
                readyState = 1;
                constructor(url, { headers }) {
                    super();
                    assert.equal(url, 'wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional');
                    assert.equal(headers.Authorization, 'Basic test-key');
                    setImmediate(() => {
                        this.emit('open');
                        if (name === 'mic') {
                            mic.stdout.emit('data', Buffer.alloc(3200));
                            if (mode === 'mic-exit' || mode === 'mic-failure') {
                                mic.stdout.emit('data', Buffer.alloc(2));
                                micClosed = true;
                                const code = mode === 'mic-failure' ? 1 : 0;
                                mic.emit('exit', code);
                                mic.emit('close', code);
                            }
                            signals.emit('SIGINT');
                            signals.emit('SIGINT');
                        }
                    });
                }
                send(raw) {
                    const frame = JSON.parse(raw);
                    frames.push(frame);
                    if (frame.closeStream && mode !== 'timeout') {
                        setTimeout(() => {
                            if (mode === 'error') {
                                this.emit('message', Buffer.from(JSON.stringify({ error: { code: 3, message: 'Invalid audio' } })));
                                return;
                            }
                            if (mode === 'partial') {
                                this.emit('message', Buffer.from(JSON.stringify({ result: { transcription: { transcript: 'unfinished', isFinal: false } } })));
                                this.close();
                                return;
                            }
                            for (const result of [
                                { transcription: { transcript: 'hello', isFinal: false } },
                                { transcription: { transcript: 'hello world', isFinal: false } },
                                { transcription: { transcript: 'hello world.', isFinal: true } },
                                { usage: { transcribedAudioMs: 100, modelId: 'inworld/inworld-stt-1' } }
                            ]) this.emit('message', Buffer.from(JSON.stringify({ result })));
                            this.close();
                        }, 5);
                    }
                }
                close() { this.readyState = 3; this.emit('close', 1000); }
                terminate() { this.readyState = 3; this.emit('close', 1006); }
            }
            const context = {
                require(id) {
                    if (id === 'ws') return Socket;
                    if (id === 'fs') return { readFileSync: () => Buffer.alloc(3202) };
                    if (id === 'child_process') return { spawn: () => mic, execSync() {} };
                    if (id === 'dotenv') return { config() {} };
                    return require(id);
                },
                module: { exports: {} }, Buffer,
                process: Object.assign(signals, { platform: 'darwin', env: {} }),
                console: { log: (...args) => logs.push(args), error() {} },
                setTimeout: (fn, ms) => setTimeout(fn, ms === 10000 ? 30 : 1),
                clearTimeout
            };
            const file = path.join(__dirname, `example_stt_${name}.js`);
            vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\nmodule.exports.run = typeof streamTranscribe === "function" ? streamTranscribe : streamMicToStt;', context);
            const run = context.module.exports.run;
            const result = name === 'mic' ? run('test-key') : run('audio.pcm', 16000, 1, 'test-key');
            if (mode === 'timeout') await assert.rejects(result, /Timed out/);
            else if (mode === 'mic-failure') await assert.rejects(result, /SoX exited with code 1/);
            else if (mode === 'error') await assert.rejects(result, /Invalid audio/);
            else if (mode === 'partial') await assert.rejects(result, /unfinalized/);
            else {
                assert.deepEqual(Array.from((await result).finalTexts), ['hello world.']);
                assert.ok(logs.some(args => args[0] === 'Usage:'));
            }
            if (mode === 'mic-failure') {
                assert.equal(signals.listenerCount('SIGINT'), 0);
                return;
            }
            assert.deepEqual(frames.map(frame => Object.keys(frame)[0]), ['transcribeConfig', 'audioChunk', 'audioChunk', 'closeStream']);
            assert.equal(Buffer.from(frames[2].audioChunk.content, 'base64').length, 2);
        });
    }
}
