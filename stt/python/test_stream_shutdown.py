"""Protocol regression tests; no API key, network, or microphone required."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


class ClosedOK(Exception):
    pass


class Socket:
    def __init__(self, mode):
        self.mode = mode
        self.frames = []
        self.queue = asyncio.Queue()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def send(self, raw):
        frame = json.loads(raw)
        self.frames.append(frame)
        if 'closeStream' in frame and self.mode != 'timeout':
            if self.mode == 'error':
                await self.queue.put(json.dumps({'error': {'code': 3, 'message': 'Invalid audio'}}))
                return
            if self.mode == 'partial':
                await self.queue.put(json.dumps({'result': {'transcription': {'transcript': 'unfinished', 'isFinal': False}}}))
                await self.queue.put(None)
                return
            for result in [
                {'transcription': {'transcript': 'hello', 'isFinal': False}},
                {'transcription': {'transcript': 'hello world', 'isFinal': False}},
                {'transcription': {'transcript': 'hello world.', 'isFinal': True}},
                {'usage': {'transcribedAudioMs': 100}},
            ]:
                await self.queue.put(json.dumps({'result': result}))
            await self.queue.put(None)

    async def recv(self):
        raw = await self.queue.get()
        if raw is None:
            raise ClosedOK()
        return raw

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return await self.recv()
        except ClosedOK:
            raise StopAsyncIteration

    async def close(self):
        await self.queue.put(None)


class ShutdownTest(unittest.IsolatedAsyncioTestCase):
    async def test_file_examples(self):
        for name in ['websocket', 'with_vad_config', 'with_voice_profile', 'mic']:
            for mode in ['success', 'timeout', 'error', 'partial']:
                with self.subTest(example=name, mode=mode):
                    ws = Socket(mode)

                    def connect(url, additional_headers):
                        self.assertEqual(url, 'wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional')
                        self.assertEqual(additional_headers, {'Authorization': 'Basic test-key'})
                        return ws

                    fake = types.SimpleNamespace(connect=connect, exceptions=types.SimpleNamespace(ConnectionClosedOK=ClosedOK))
                    path = Path(__file__).with_name(f'example_stt_{name}.py')
                    spec = importlib.util.spec_from_file_location(name, path)
                    module = importlib.util.module_from_spec(spec)
                    stop_callbacks = []
                    class Mic:
                        def __init__(self, **kwargs):
                            self.callback = kwargs['callback']
                            self.stopped = False
                        def start(self):
                            self.callback(bytes(3200), 1600, None, None)
                            asyncio.get_running_loop().call_soon(stop_callbacks[0])
                        def stop(self):
                            if not self.stopped:
                                self.stopped = True
                                self.callback(bytes(2), 1, None, None)
                        def close(self):
                            pass
                    with patch.dict(sys.modules, {'websockets': fake, 'sounddevice': types.SimpleNamespace(RawInputStream=Mic)}):
                        spec.loader.exec_module(module)
                    module.CLOSE_GRACE_MS = 10
                    with tempfile.NamedTemporaryFile() as pcm, patch('builtins.print') as output, patch.object(asyncio.get_running_loop(), 'add_signal_handler', side_effect=lambda sig, callback: stop_callbacks.append(callback)):
                        pcm.write(bytes(3202))
                        pcm.flush()
                        call = module.stream_mic_to_stt('test-key') if name == 'mic' else module.stream_transcribe(pcm.name, 16000, 1, 'test-key')
                        if mode == 'timeout':
                            with self.assertRaisesRegex(TimeoutError, 'Timed out'):
                                await asyncio.wait_for(call, 2)
                        elif mode in ['error', 'partial']:
                            with self.assertRaisesRegex(RuntimeError, 'Invalid audio' if mode == 'error' else 'unfinalized'):
                                await asyncio.wait_for(call, 2)
                        else:
                            self.assertEqual(await asyncio.wait_for(call, 2), ['hello world.'])
                            self.assertTrue(any(args[0] == 'Usage:' for args, _ in output.call_args_list))
                    self.assertEqual([next(iter(frame)) for frame in ws.frames], ['transcribeConfig', 'audioChunk', 'audioChunk', 'closeStream'])


if __name__ == '__main__':
    unittest.main()
