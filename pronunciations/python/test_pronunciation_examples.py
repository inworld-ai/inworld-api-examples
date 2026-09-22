"""Offline request-contract tests. No API key or network access is used."""

import base64
import copy
import io
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

import example_create_dictionary as create_example
import example_pronunciation_dictionaries as crud
import example_tts_with_dictionary as tts
import example_tts_with_workspace_dictionary as workspace_tts

NAME = (
    "workspaces/example/pronunciationDictionaries/7b5c9b84-1faa-4c54-a7c9-3778d5e76cc9"
)


class Response:
    def __init__(self, data=None, status=200):
        self.status_code = status
        self.data = data if data is not None else {}
        self.content = json.dumps(self.data).encode()
        self.text = "DO_NOT_PRINT_RESPONSE_OR_CREDENTIALS"

    def json(self):
        return self.data


class Session:
    def __init__(self):
        self.headers = {}
        self.responses = []
        self.calls = []
        self.closed = False

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, copy.deepcopy(kwargs)))
        if not self.responses:
            raise AssertionError(
                "Unexpected request: network access is never permitted"
            )
        result = self.responses.pop(0)
        if callable(result):
            result = result(method, url, kwargs)
        if isinstance(result, BaseException):
            raise result
        return result

    def close(self):
        self.closed = True


class PronunciationExamplesTest(unittest.TestCase):
    def setUp(self):
        self.session = Session()
        self.addCleanup(patch.stopall)
        patch.object(crud.requests, "Session", return_value=self.session).start()
        self.stdout = patch("sys.stdout", new_callable=io.StringIO).start()
        self.stderr = patch("sys.stderr", new_callable=io.StringIO).start()
        self.client = crud.PronunciationDictionariesClient(
            "test-key", "example", "https://example.test"
        )

    def test_workspace_tts_only_sends_synthesis_and_the_default_selector(self):
        audio = b"ID3workspace-audio"
        self.session.responses = [
            Response({"audioContent": base64.b64encode(audio).decode()}),
            Response({"audioContent": base64.b64encode(audio + b"selected").decode()}),
        ]
        directory = workspace_tts.synthesize_workspace_comparison(self.client)
        self.addCleanup(shutil.rmtree, directory)
        self.assertEqual((directory / "baseline.mp3").read_bytes(), audio)
        self.assertEqual(
            (directory / "with-workspace-dictionary.mp3").read_bytes(),
            audio + b"selected",
        )
        self.assertEqual(
            [(call[0], call[1]) for call in self.session.calls],
            [("POST", "https://example.test/tts/v1/voice")] * 2,
        )
        baseline, selected = [call[2]["json"] for call in self.session.calls]
        self.assertEqual(baseline["text"], "The Cat is on the mat.")
        self.assertEqual(baseline["language"], "en-US")
        self.assertNotIn("enable_custom_pronunciation", baseline)
        self.assertNotIn("pronunciationDictionarySettings", baseline)
        self.assertEqual(selected, {**baseline, "enable_custom_pronunciation": True})

    def test_workspace_tts_failure_does_not_create_files_or_retry(self):
        self.session.responses = [Response({"audioContent": "YQ=="}), Response(status=503)]
        with patch.object(workspace_tts.tempfile, "mkdtemp") as mkdtemp:
            with self.assertRaises(crud.ApiError) as error:
                workspace_tts.synthesize_workspace_comparison(self.client)
        self.assertEqual(error.exception.status_code, 503)
        mkdtemp.assert_not_called()
        self.assertEqual(len(self.session.calls), 2)

    def test_create_retains_all_five_fixture_entries(self):
        def create_response(method, url, kwargs):
            return Response({"name": NAME, "etag": "one", **kwargs["json"]})

        self.session.responses = [create_response]
        dictionary = create_example.create_sample_dictionary(self.client)
        sample = json.loads(create_example.SAMPLE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(dictionary["pronunciations"], sample["pronunciations"])
        self.assertEqual(len(dictionary["pronunciations"]), 5)
        self.assertLessEqual(len(dictionary["displayName"]), 64)
        self.assertTrue(
            dictionary["displayName"].startswith(sample["displayName"] + " ")
        )
        self.assertEqual([call[0] for call in self.session.calls], ["POST"])
        self.assertIn(NAME, self.stdout.getvalue())

    def test_create_timeout_prints_reconciliation_name_without_retry(self):
        self.session.responses = [
            requests.Timeout("DO_NOT_PRINT_RESPONSE_OR_CREDENTIALS")
        ]
        with self.assertRaisesRegex(RuntimeError, "Timeout"):
            create_example.create_sample_dictionary(self.client)
        self.assertEqual(len(self.session.calls), 1)
        self.assertIn(
            self.session.calls[0][2]["json"]["displayName"], self.stderr.getvalue()
        )
        self.assertIn("before rerunning", self.stderr.getvalue())
        self.assertNotIn("DO_NOT_PRINT", self.stderr.getvalue())

    def test_tts_writes_baseline_and_selected_audio_without_mutations(self):
        audio = b"ID3offline-audio"
        self.session.responses = [
            Response({"name": NAME}),
            Response({"audioContent": base64.b64encode(audio).decode()}),
            Response({"audioContent": base64.b64encode(audio + b"selected").decode()}),
        ]
        directory = tts.synthesize_comparison(self.client, NAME)
        self.addCleanup(shutil.rmtree, directory)
        self.assertEqual((directory / "baseline.mp3").read_bytes(), audio)
        self.assertEqual(
            (directory / "with-dictionary.mp3").read_bytes(), audio + b"selected"
        )
        self.assertEqual(
            [call[0] for call in self.session.calls], ["GET", "POST", "POST"]
        )
        baseline, selected = [call[2]["json"] for call in self.session.calls[1:]]
        self.assertNotIn("pronunciationDictionarySettings", baseline)
        self.assertEqual(
            selected.pop("pronunciationDictionarySettings"),
            {"dictionaries": [{"dictionary": NAME}]},
        )
        self.assertEqual(baseline, selected)
        self.assertEqual(
            baseline["text"], tts.TEXT_PATH.read_text(encoding="utf-8").strip()
        )
        self.assertEqual(baseline["voiceId"], "Ashley")
        self.assertEqual(baseline["modelId"], "inworld-tts-2")
        self.assertEqual(baseline["language"], "en-US")
        self.assertNotIn("languageCode", baseline)
        self.assertEqual(baseline["audioConfig"], {"audioEncoding": "MP3"})
        self.assertEqual(baseline["seed"], 101)
        self.assertTrue(
            all(
                call[1] == "https://example.test/tts/v1/voice"
                for call in self.session.calls[1:]
            )
        )

    def test_tts_rejects_wrong_workspace_before_any_request(self):
        with self.assertRaisesRegex(ValueError, "INWORLD_WORKSPACE_ID"):
            tts.synthesize_comparison(
                self.client, NAME.replace("/example/", "/another/")
            )
        self.assertEqual(self.session.calls, [])

    def test_tts_missing_dictionary_prevents_synthesis(self):
        self.session.responses = [Response(status=404)]
        with self.assertRaises(crud.ApiError) as error:
            tts.synthesize_comparison(self.client, NAME)
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual([call[0] for call in self.session.calls], ["GET"])

    def test_tts_rejects_unexpected_get_resource(self):
        self.session.responses = [
            Response({"name": NAME.replace("/example/", "/another/")})
        ]
        with self.assertRaisesRegex(RuntimeError, "unexpected dictionary name"):
            tts.synthesize_comparison(self.client, NAME)
        self.assertEqual(len(self.session.calls), 1)

    def test_decode_audio_rejects_missing_empty_and_invalid_payloads(self):
        for value in (None, "", 123, "not base64!", "===="):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                tts.decode_audio({"audioContent": value})
        with self.assertRaises(RuntimeError):
            tts.decode_audio({})

    def test_patch_supplies_explicit_mask_and_body_etag(self):
        self.session.responses = [Response()]
        self.client.update_dictionary(
            {"name": NAME, "etag": "one"}, "Updated", crud.REPLACEMENT_PRONUNCIATIONS
        )
        method, _, kwargs = self.session.calls[0]
        self.assertEqual(method, "PATCH")
        self.assertEqual(kwargs["params"], {"updateMask": "displayName,pronunciations"})
        self.assertEqual(kwargs["json"]["etag"], "one")

    def prepare_lost_update(self, concurrent_edit=False):
        current = {}

        def create_response(method, url, kwargs):
            current.update({"name": NAME, "etag": "one", **kwargs["json"]})
            return Response(copy.deepcopy(current))

        def get_response(*_):
            return Response(copy.deepcopy(current))

        def lost_update(method, url, kwargs):
            current.update(kwargs["json"])
            current["etag"] = "two"
            if concurrent_edit:
                current["pronunciations"] = []
            return requests.Timeout("private transport details")

        self.session.responses = [
            create_response,
            Response({"pronunciationDictionaries": []}),
            get_response,
            lost_update,
            get_response,
        ]
        if not concurrent_edit:
            self.session.responses.append(Response())

    def test_lost_update_cleanup_uses_fresh_etag_and_preserves_primary_error(self):
        self.prepare_lost_update()
        with self.assertRaisesRegex(RuntimeError, "PATCH request failed.*Timeout"):
            crud.run_lifecycle(self.client)
        self.assertEqual(
            [call[0] for call in self.session.calls],
            ["POST", "GET", "GET", "PATCH", "GET", "DELETE"],
        )
        self.assertEqual(self.session.calls[-1][2]["params"], {"etag": "two"})

    def test_cleanup_refuses_concurrent_content_edit(self):
        self.prepare_lost_update(concurrent_edit=True)
        with self.assertRaisesRegex(RuntimeError, "PATCH request failed.*Timeout"):
            crud.run_lifecycle(self.client)
        self.assertNotIn("DELETE", [call[0] for call in self.session.calls])
        self.assertIn("refusing deletion", self.stderr.getvalue())
        self.assertIn(NAME, self.stderr.getvalue())

    def test_lifecycle_refuses_content_changed_before_patch(self):
        def create_response(method, url, kwargs):
            self.current = {"name": NAME, "etag": "one", **kwargs["json"]}
            return Response(copy.deepcopy(self.current))

        def edited_response(*_):
            self.current["pronunciations"] = []
            self.current["etag"] = "two"
            return Response(copy.deepcopy(self.current))

        self.session.responses = [
            create_response,
            Response(),
            edited_response,
            edited_response,
        ]
        with self.assertRaisesRegex(RuntimeError, "refusing to update"):
            crud.run_lifecycle(self.client)
        self.assertEqual(
            [call[0] for call in self.session.calls], ["POST", "GET", "GET", "GET"]
        )
        self.assertIn("refusing deletion", self.stderr.getvalue())

    def test_mutations_require_nonempty_etag_before_request(self):
        for etag in (None, "", 123):
            dictionary = {"name": NAME, "etag": etag}
            with self.subTest(etag=etag):
                with self.assertRaisesRegex(ValueError, "non-empty dictionary ETag"):
                    self.client.update_dictionary(dictionary, "Updated", [])
                with self.assertRaisesRegex(ValueError, "non-empty dictionary ETag"):
                    self.client.delete_dictionary(dictionary)
        self.assertEqual(self.session.calls, [])

    def test_imports_do_not_load_environment_credentials(self):
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                """
import sys
import types
dotenv = types.ModuleType('dotenv')
def forbidden(*args, **kwargs):
    raise AssertionError('Import must not load dotenv')
dotenv.load_dotenv = forbidden
sys.modules['dotenv'] = dotenv
import example_pronunciation_dictionaries
import example_create_dictionary
import example_tts_with_dictionary
""",
            ],
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_lifecycle_rejects_unexpected_update_response_before_delete(self):
        def create_response(method, url, kwargs):
            self.current = {"name": NAME, "etag": "one", **kwargs["json"]}
            return Response(copy.deepcopy(self.current))

        def get_response(*_):
            return Response(copy.deepcopy(self.current))

        def changed_update_response(method, url, kwargs):
            self.current.update(kwargs["json"])
            self.current.update({"etag": "two", "pronunciations": []})
            return Response(copy.deepcopy(self.current))

        self.session.responses = [
            create_response,
            Response(),
            get_response,
            changed_update_response,
            get_response,
        ]
        with self.assertRaisesRegex(
            RuntimeError, "does not match the intended contents"
        ):
            crud.run_lifecycle(self.client)
        self.assertNotIn("DELETE", [call[0] for call in self.session.calls])
        self.assertIn("refusing deletion", self.stderr.getvalue())

    def test_cleanup_failure_does_not_replace_lost_update_error(self):
        self.prepare_lost_update()
        self.session.responses[-1] = Response(status=409)
        with self.assertRaisesRegex(RuntimeError, "PATCH request failed.*Timeout"):
            crud.run_lifecycle(self.client)
        self.assertIn("HTTP 409", self.stderr.getvalue())
        self.assertIn(NAME, self.stderr.getvalue())

    def test_already_deleted_cleanup_preserves_primary_error(self):
        self.prepare_lost_update()
        self.session.responses[-2:] = [Response(status=404)]
        with self.assertRaisesRegex(RuntimeError, "PATCH request failed.*Timeout"):
            crud.run_lifecycle(self.client)
        self.assertNotIn("DELETE", [call[0] for call in self.session.calls])
        self.assertNotIn("Cleanup failed", self.stderr.getvalue())

    def test_malformed_create_does_not_mask_error_or_guess_cleanup_target(self):
        self.session.responses = [Response({"etag": "one"})]
        with self.assertRaises(KeyError) as error:
            crud.run_lifecycle(self.client)
        self.assertEqual(error.exception.args, ("name",))
        self.assertEqual([call[0] for call in self.session.calls], ["POST"])
        self.assertIn("before rerunning", self.stderr.getvalue())

    def test_http_errors_and_redirects_are_not_retried_or_dumped(self):
        for status in (302, 400, 409, 503, 504):
            with self.subTest(status=status):
                self.session.responses = [Response(status=status)]
                before = len(self.session.calls)
                with self.assertRaises(crud.ApiError) as error:
                    self.client.get_dictionary(NAME)
                self.assertEqual(error.exception.status_code, status)
                self.assertNotIn("DO_NOT_PRINT", str(error.exception))
                self.assertEqual(len(self.session.calls), before + 1)
                self.assertFalse(self.session.calls[-1][2]["allow_redirects"])
                self.assertEqual(self.session.calls[-1][2]["timeout"], 30)

    def test_session_is_closed_by_context_manager(self):
        with self.client:
            pass
        self.assertTrue(self.session.closed)


if __name__ == "__main__":
    unittest.main()
