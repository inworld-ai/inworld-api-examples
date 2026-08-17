#!/usr/bin/env python3
"""Manage a named pronunciation dictionary through Inworld's public REST API."""

import json
import os
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

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
        return self._request(
            "PATCH",
            self._resource_url(dictionary["name"]),
            params={"updateMask": "displayName,pronunciations"},
            json={
                "name": dictionary["name"],
                "displayName": display_name,
                "pronunciations": pronunciations,
                "etag": dictionary["etag"],
            },
        )

    def delete_dictionary(self, dictionary: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "DELETE",
            self._resource_url(dictionary["name"]),
            params={"etag": dictionary["etag"]},
        )

    def _resource_url(self, name: str) -> str:
        expected_prefix = f"workspaces/{self.workspace_id}/pronunciationDictionaries/"
        if not name.startswith(expected_prefix):
            raise ValueError(f"Unexpected pronunciation dictionary name: {name}")
        encoded_name = "/".join(quote(segment, safe="") for segment in name.split("/"))
        return f"{self.api_base_url}/pronunciations/v1/{encoded_name}"

    def _request(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        response = self.session.request(
            method,
            url,
            timeout=REQUEST_TIMEOUT_SECONDS,
            **kwargs,
        )
        if not response.ok:
            raise RuntimeError(
                f"{method} {response.url} failed with HTTP {response.status_code}: "
                f"{response.text}"
            )
        return response.json()


def print_result(label: str, value: dict[str, Any]) -> None:
    """Print an API response without escaping IPA symbols."""
    print(f"\n{label}")
    print(json.dumps(value, indent=2, ensure_ascii=False))


def run_lifecycle(client: PronunciationDictionariesClient) -> None:
    """Run create, list, get, update, and delete with cleanup on failure."""
    dictionary: dict[str, Any] | None = None
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    try:
        dictionary = client.create_dictionary(
            display_name=f"API example {timestamp}",
            pronunciations=INITIAL_PRONUNCIATIONS,
        )
        print_result("1. Created dictionary", dictionary)

        page = client.list_dictionaries(page_size=5)
        print_result("2. Listed dictionaries (first page)", page)

        dictionary = client.get_dictionary(dictionary["name"])
        print_result("3. Retrieved dictionary", dictionary)

        dictionary = client.update_dictionary(
            dictionary=dictionary,
            display_name=f"API example updated {timestamp}",
            pronunciations=REPLACEMENT_PRONUNCIATIONS,
        )
        print_result("4. Replaced dictionary contents", dictionary)

        delete_response = client.delete_dictionary(dictionary)
        print_result("5. Deleted dictionary", delete_response)
        dictionary = None
    finally:
        if dictionary is not None:
            try:
                client.delete_dictionary(dictionary)
                print("\nCleaned up the dictionary after an incomplete run.")
            except (
                requests.RequestException,
                RuntimeError,
                ValueError,
                KeyError,
            ) as cleanup_error:
                print(
                    f"\nCleanup failed; delete {dictionary['name']} manually: "
                    f"{cleanup_error}",
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


def main() -> int:
    """Load configuration and run the example."""
    try:
        client = PronunciationDictionariesClient(
            api_key=require_environment_variable("INWORLD_API_KEY"),
            workspace_id=require_environment_variable("INWORLD_WORKSPACE_ID"),
            api_base_url=os.getenv("INWORLD_API_BASE_URL", DEFAULT_API_BASE_URL),
        )
        run_lifecycle(client)
    except (requests.RequestException, RuntimeError, ValueError, KeyError) as error:
        print(f"Pronunciation dictionary example failed: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
