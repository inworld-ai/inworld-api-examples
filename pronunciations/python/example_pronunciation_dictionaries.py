#!/usr/bin/env python3
"""Manage a named pronunciation dictionary through Inworld's public REST API."""

import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import UUID, uuid4

import requests

DEFAULT_API_BASE_URL = "https://api.inworld.ai"
REQUEST_TIMEOUT_SECONDS = 30

INITIAL_PRONUNCIATIONS = [
    {
        "displayHeadword": "Cat",
        "languageCode": "en-US",
        "phoneSymbols": ["k", "æ", "t"],
    },
    {
        "displayHeadword": "Ship",
        "languageCode": "en-US",
        "phoneSymbols": ["ʃ", "ɪ", "p"],
    },
]

REPLACEMENT_PRONUNCIATIONS = [
    {
        "displayHeadword": "Red",
        "languageCode": "en-US",
        "phoneSymbols": ["ɹ", "ɛ", "d"],
    }
]


class ApiError(RuntimeError):
    """An HTTP error with a status usable for bounded cleanup."""

    def __init__(self, method: str, status_code: int):
        self.status_code = status_code
        super().__init__(f"{method} request failed with HTTP {status_code}.")


class PronunciationDictionariesClient:
    """Minimal client for the five public pronunciation dictionary methods."""

    def __init__(self, api_key: str, workspace_id: str, api_base_url: str):
        self.api_base_url = api_base_url.rstrip("/")
        self.workspace_id = workspace_id
        encoded_workspace_id = quote(workspace_id, safe="")
        self.collection_url = (
            f"{self.api_base_url}/pronunciations/v1/workspaces/"
            f"{encoded_workspace_id}/pronunciationDictionaries"
        )
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Basic {api_key}",
                "Content-Type": "application/json",
            }
        )

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.session.close()

    def create_dictionary(
        self, display_name: str, pronunciations: list[dict[str, Any]]
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            self.collection_url,
            json={
                "displayName": display_name,
                "pronunciations": pronunciations,
            },
        )

    def list_dictionaries(self, page_size: int = 5) -> dict[str, Any]:
        return self._request(
            "GET",
            self.collection_url,
            params={"pageSize": page_size},
        )

    def get_dictionary(self, name: str) -> dict[str, Any]:
        return self._request("GET", self._resource_url(name))

    def update_dictionary(
        self,
        dictionary: dict[str, Any],
        display_name: str,
        pronunciations: list[dict[str, Any]],
    ) -> dict[str, Any]:
        require_etag(dictionary)
        return self._request(
            "PATCH",
            self._resource_url(dictionary["name"]),
            params={"updateMask": "displayName,pronunciations"},
            json={
                "displayName": display_name,
                "pronunciations": pronunciations,
                "etag": dictionary["etag"],
            },
        )

    def delete_dictionary(self, dictionary: dict[str, Any]) -> dict[str, Any]:
        require_etag(dictionary)
        return self._request(
            "DELETE",
            self._resource_url(dictionary["name"]),
            params={"etag": dictionary["etag"]},
        )

    def _resource_url(self, name: str) -> str:
        expected_prefix = f"workspaces/{self.workspace_id}/pronunciationDictionaries/"
        if not isinstance(name, str) or not name.startswith(expected_prefix):
            raise ValueError("Dictionary name must belong to INWORLD_WORKSPACE_ID.")
        try:
            UUID(name[len(expected_prefix) :])
        except ValueError:
            raise ValueError(
                "Dictionary name must end in the returned dictionary UUID."
            ) from None
        encoded_name = "/".join(quote(segment, safe="") for segment in name.split("/"))
        return f"{self.api_base_url}/pronunciations/v1/{encoded_name}"

    def _request(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = self.session.request(
                method,
                url,
                timeout=REQUEST_TIMEOUT_SECONDS,
                allow_redirects=False,
                **kwargs,
            )
        except requests.RequestException as error:
            raise RuntimeError(
                f"{method} request failed ({type(error).__name__}); its outcome may be unknown."
            ) from error
        if not 200 <= response.status_code < 300:
            raise ApiError(method, response.status_code)
        if not response.content:
            return {}
        try:
            result = response.json()
        except ValueError:
            raise RuntimeError(f"{method} returned an invalid JSON response.") from None
        if not isinstance(result, dict):
            raise RuntimeError(f"{method} returned an unexpected JSON response shape.")
        return result


def print_result(label: str, value: dict[str, Any]) -> None:
    """Print an API response without escaping IPA symbols."""
    print(f"\n{label}")
    print(json.dumps(value, indent=2, ensure_ascii=False))


def require_etag(dictionary: dict[str, Any]) -> None:
    if not isinstance(dictionary.get("etag"), str) or not dictionary["etag"]:
        raise ValueError("A current, non-empty dictionary ETag is required.")


def dictionary_state(dictionary: dict[str, Any]) -> tuple[Any, Any]:
    entries = dictionary.get("pronunciations")
    if isinstance(entries, list) and all(isinstance(entry, dict) for entry in entries):
        entries = [
            {
                "displayHeadword": entry.get("displayHeadword"),
                "languageCode": entry.get("languageCode"),
                "phoneSymbols": entry.get("phoneSymbols"),
            }
            for entry in entries
        ]
    return dictionary.get("displayName"), entries


def run_lifecycle(client: PronunciationDictionariesClient) -> None:
    """Run create, list, get, update, and delete with cleanup on failure."""
    dictionary: dict[str, Any] | None = None
    created_name: str | None = None
    deleted = False
    run_id = uuid4().hex
    initial_name = f"API example {run_id}"
    updated_name = f"API example updated {run_id}"
    owned_states = [(initial_name, INITIAL_PRONUNCIATIONS)]
    print(f"Creating dictionary with displayName: {initial_name}")

    try:
        dictionary = client.create_dictionary(
            display_name=initial_name,
            pronunciations=INITIAL_PRONUNCIATIONS,
        )
        client._resource_url(dictionary["name"])
        created_name = dictionary["name"]
        print_result("1. Created dictionary", dictionary)

        page = client.list_dictionaries(page_size=5)
        print_result("2. Listed dictionaries (first page)", page)

        dictionary = client.get_dictionary(dictionary["name"])
        if (
            dictionary.get("name") != created_name
            or dictionary_state(dictionary) != owned_states[0]
        ):
            raise RuntimeError(
                "Dictionary changed unexpectedly; refusing to update it."
            )
        print_result("3. Retrieved dictionary", dictionary)

        owned_states.append((updated_name, REPLACEMENT_PRONUNCIATIONS))
        dictionary = client.update_dictionary(
            dictionary=dictionary,
            display_name=updated_name,
            pronunciations=REPLACEMENT_PRONUNCIATIONS,
        )
        if (
            dictionary.get("name") != created_name
            or dictionary_state(dictionary) != owned_states[1]
        ):
            raise RuntimeError(
                "Updated dictionary does not match the intended contents."
            )
        print_result("4. Replaced dictionary contents", dictionary)

        delete_response = client.delete_dictionary(dictionary)
        print_result("5. Deleted dictionary", delete_response)
        deleted = True
    finally:
        if created_name is not None and not deleted:
            try:
                current = client.get_dictionary(created_name)
                if (
                    current.get("name") != created_name
                    or dictionary_state(current) not in owned_states
                ):
                    raise RuntimeError(
                        "Dictionary changed outside this run; refusing deletion."
                    )
                client.delete_dictionary(current)
                print("\nCleaned up the dictionary after an incomplete run.")
            except ApiError as cleanup_error:
                if cleanup_error.status_code != 404:
                    print(
                        f"\nCleanup failed; inspect {created_name} manually: {cleanup_error}",
                        file=sys.stderr,
                    )
            except (
                requests.RequestException,
                RuntimeError,
                ValueError,
                KeyError,
            ) as cleanup_error:
                print(
                    f"\nCleanup failed; inspect {created_name} manually: "
                    f"{cleanup_error}",
                    file=sys.stderr,
                )
        elif created_name is None:
            # An unsuccessful create may have committed without returning its name.
            if sys.exc_info()[0] is not None:
                print(
                    f"Inspect the dictionary list for displayName {initial_name!r} "
                    "before rerunning; create may have committed.",
                    file=sys.stderr,
                )


def require_environment_variable(name: str) -> str:
    """Return a required environment variable or raise a focused error."""
    value = os.getenv(name)
    if not value:
        raise ValueError(
            f"{name} is not set. Copy .env.example to .env and provide a value."
        )
    return value


def client_from_environment() -> PronunciationDictionariesClient:
    """Load script-local configuration only when an entrypoint is executed."""
    try:
        from dotenv import load_dotenv

        load_dotenv(Path(__file__).with_name(".env"))
    except ImportError:
        pass
    return PronunciationDictionariesClient(
        api_key=require_environment_variable("INWORLD_API_KEY"),
        workspace_id=require_environment_variable("INWORLD_WORKSPACE_ID"),
        api_base_url=os.getenv("INWORLD_API_BASE_URL", DEFAULT_API_BASE_URL),
    )


def main() -> int:
    """Load configuration and run the example."""
    try:
        with client_from_environment() as client:
            run_lifecycle(client)
    except (requests.RequestException, RuntimeError, ValueError, KeyError) as error:
        print(f"Pronunciation dictionary example failed: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
