"""Offline tests. No API key or network access is used."""

import asyncio
import base64
import io
import json
import re
import unittest
from unittest.mock import patch

import example_llm_steering_stream as stream
import example_reasoning as reasoning

REPLY = ("[barely containing excitement like announcing a surprise] You did! First prize is yours. "
         "Dr. Lee will call you... maybe tomorrow. [reset] I'll email you the details tonight.")


def pieces(text, size):
    return [text[i:i + size] for i in range(0, len(text), size)]


def balanced(text):
    return text.count("[") == text.count("]")


class SentenceBufferTest(unittest.TestCase):
    def run_buffer(self, tokens):
        buffer = stream.SentenceBuffer()
        out = [s for token in tokens for s in buffer.push(token)]
        return out, buffer.flush()

    def test_cuts_sentences_and_keeps_tags_with_their_words(self):
        sentences, rest = self.run_buffer([REPLY])
        self.assertEqual(sentences, [
            "[barely containing excitement like announcing a surprise] You did! ",
            "First prize is yours. ",
            "Dr. Lee will call you... maybe tomorrow. ",
        ])
        self.assertEqual(rest, "[reset] I'll email you the details tonight.")

    def test_tag_split_across_tokens_is_never_cut(self):
        for size in range(1, 12):
            with self.subTest(size=size):
                sentences, rest = self.run_buffer(pieces(REPLY, size))
                self.assertEqual("".join(sentences) + rest, REPLY)
                for sentence in sentences:
                    self.assertTrue(balanced(sentence), sentence)

    def test_unclosed_tag_holds_back_text(self):
        buffer = stream.SentenceBuffer()
        self.assertEqual(buffer.push("Sure thing. [whisper"), ["Sure thing. "])
        self.assertEqual(buffer.push(" softly. Don't"), [])
        self.assertEqual(buffer.push("] Keep it secret. "), ["[whisper softly. Don't] Keep it secret. "])

    def test_period_inside_a_tag_is_not_a_sentence_end(self):
        sentences, rest = self.run_buffer(["[say it slowly. like a secret] Hi there. ", "Bye."])
        self.assertEqual(sentences, ["[say it slowly. like a secret] Hi there. "])
        self.assertEqual(rest, "Bye.")

    def test_cjk_sentences_end_without_a_space(self):
        sentences, rest = self.run_buffer(["[gently] 你好。", "我们走吧！", "好"])
        self.assertEqual(sentences, ["[gently] 你好。", "我们走吧！"])
        self.assertEqual(rest, "好")


class LlmRequestTest(unittest.TestCase):
    def test_system_prompt_ends_with_the_shared_prompt_file(self):
        prompt = stream.load_system_prompt("You are a pirate.")
        self.assertTrue(prompt.startswith("You are a pirate.\n\n"))
        self.assertTrue(prompt.endswith(stream.PROMPT_FILE.read_text(encoding="utf-8").strip()))
        body = stream.llm_request("Hi", prompt, model="some/model")
        self.assertEqual(body["model"], "some/model")
        self.assertTrue(body["stream"])
        self.assertEqual(body["messages"], [{"role": "system", "content": prompt},
                                            {"role": "user", "content": "Hi"}])

    def test_prompt_examples_follow_its_own_rules(self):
        text = stream.PROMPT_FILE.read_text(encoding="utf-8")
        replies = [line[len("You: "):] for line in text.splitlines() if line.startswith("You: ")]
        self.assertGreaterEqual(len(replies), 2)
        for tag in (t for reply in replies for t in re.findall(r"\[([^\]]*)\]", reply)):
            self.assertLessEqual(len(tag.split()), 12, tag)
            self.assertEqual(tag, tag.lower(), tag)
            self.assertIsNone(re.search(r"[^\w\s]", tag), tag)

    def test_auth_defaults_to_the_inworld_key(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(stream.llm_headers("abc"), {"Authorization": "Basic abc"})
        with patch.dict("os.environ", {"LLM_API_KEY": "sk-1"}):
            self.assertEqual(stream.llm_headers("abc"), {"Authorization": "Bearer sk-1"})

    def test_parse_sse_line(self):
        line = "data: " + json.dumps({"choices": [{"delta": {"content": "[sigh] Hi"}}]})
        self.assertEqual(stream.parse_sse_line(line), "[sigh] Hi")
        self.assertEqual(stream.parse_sse_line("data: [DONE]"), "")
        self.assertEqual(stream.parse_sse_line(": keep-alive"), "")
        self.assertEqual(stream.parse_sse_line("data: " + json.dumps({"choices": [{"delta": {}}]})), "")


class ForwardReplyTest(unittest.TestCase):
    def test_sends_sentences_with_tags_then_closes(self):
        async def tokens():
            for token in pieces(REPLY, 3):
                yield token

        sent = []

        async def send(message):
            sent.append(message)

        with patch("sys.stdout", new_callable=io.StringIO):
            asyncio.run(stream.forward_reply(tokens(), send, "ctx"))
        self.assertEqual(sent[-1], {"contextId": "ctx", "closeContext": {}})
        texts = [m["sendText"]["text"] for m in sent[:-1]]
        self.assertEqual("".join(texts), REPLY)
        self.assertEqual(len(texts), 4)
        self.assertTrue(all(m["contextId"] == "ctx" and "flushContext" in m["sendText"] for m in sent[:-1]))
        self.assertTrue(all(balanced(t) for t in texts))

    def test_strip_wav_header(self):
        pcm = b"\x01\x02\x03\x04"
        wav = b"RIFF" + (36 + len(pcm)).to_bytes(4, "little") + b"WAVE" + b"fmt " + (16).to_bytes(4, "little") \
            + bytes(16) + b"data" + len(pcm).to_bytes(4, "little") + pcm
        self.assertEqual(stream.strip_wav_header(wav), pcm)
        self.assertEqual(stream.strip_wav_header(pcm), pcm)


class Response:
    def __init__(self, data=None, lines=(), status=200):
        self.status_code = status
        self.data = data
        self.lines = lines
        self.text = ""

    def json(self):
        return self.data

    def iter_lines(self, decode_unicode=False):
        return iter(self.lines)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


AUDIO = base64.b64encode(b"mp3").decode()


class ReasoningTest(unittest.TestCase):
    def test_request_turns_reasoning_on_with_context(self):
        body = reasoning.build_request("Hi.", "A tense scene.", ["Did you hear that?"])
        self.assertEqual(body["modelId"], "inworld-tts-2")
        self.assertEqual(body["synthesisContext"], {
            "reasoning": "REASONING_ON",
            "reasoningContext": "A tense scene.",
            "previousRequests": [{"text": "Did you hear that?"}],
        })
        self.assertEqual(reasoning.build_request("Hi.")["synthesisContext"], {"reasoning": "REASONING_ON"})
        self.assertLessEqual(len(reasoning.REASONING_CONTEXT), 600)

    def test_unary_returns_instruction_and_audio(self):
        response = Response({"audioContent": AUDIO, "reasoningInstruction": "say it with dread"})
        with patch.object(reasoning.requests, "post", return_value=response) as post:
            self.assertEqual(reasoning.synthesize("key", {"text": "x"}), ("say it with dread", b"mp3"))
        self.assertTrue(post.call_args.args[0].endswith("/tts/v1/voice"))
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Basic key")

    def test_stream_reads_instruction_from_first_message(self):
        lines = [json.dumps({"result": {"audioContent": AUDIO, "reasoningInstruction": "hushed"}}), "",
                 json.dumps({"result": {"audioContent": AUDIO}})]
        with patch.object(reasoning.requests, "post", return_value=Response(lines=lines)) as post:
            instruction, audio, first_audio = reasoning.synthesize_stream("key", {"text": "x"})
        self.assertEqual((instruction, audio), ("hushed", b"mp3mp3"))
        self.assertGreaterEqual(first_audio, 0)
        self.assertTrue(post.call_args.args[0].endswith("/tts/v1/voice:stream"))

    def test_http_error_is_raised(self):
        error = Response({"message": "bad"}, status=400)
        with patch.object(reasoning.requests, "post", return_value=error), \
                self.assertRaisesRegex(RuntimeError, "HTTP 400"):
            reasoning.synthesize("key", {})

    def test_describe(self):
        self.assertIn("[hushed] Hi.", reasoning.describe("hushed", "Hi."))
        self.assertIn("no instruction", reasoning.describe("", "Hi."))


if __name__ == "__main__":
    unittest.main()
