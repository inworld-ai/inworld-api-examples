package ai.inworld.voiceagent

import ai.inworld.voiceagent.auth.IceServer
import ai.inworld.voiceagent.realtime.LlmModelInfo
import ai.inworld.voiceagent.realtime.events.EventJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CatalogDecodingTest {
    @Test
    fun iceServerUrlsAsArray() {
        val server = EventJson.decodeFromString<IceServer>(
            """{"urls": ["stun:stun.example.com", "turn:turn.example.com"], "username": "u", "credential": "c"}""",
        )
        assertEquals(listOf("stun:stun.example.com", "turn:turn.example.com"), server.urls)
        assertEquals("u", server.username)
        assertEquals("c", server.credential)
    }

    @Test
    fun iceServerUrlsAsSingleString() {
        val server = EventJson.decodeFromString<IceServer>("""{"urls": "stun:stun.example.com"}""")
        assertEquals(listOf("stun:stun.example.com"), server.urls)
        assertNull(server.username)
    }

    @Test
    fun realtimeIdentifierPrefixesProvider() {
        assertEquals(
            "openai/gpt-4o-mini",
            LlmModelInfo(model = "gpt-4o-mini", provider = "openai").realtimeIdentifier,
        )
    }

    @Test
    fun realtimeIdentifierKeepsExistingProviderPrefix() {
        assertEquals(
            "openai/gpt-4o-mini",
            LlmModelInfo(model = "openai/gpt-4o-mini", provider = "openai").realtimeIdentifier,
        )
    }

    @Test
    fun realtimeIdentifierPrefixesSlashContainingModel() {
        assertEquals(
            "inworld/models/GLM-5.1",
            LlmModelInfo(model = "models/GLM-5.1", provider = "inworld").realtimeIdentifier,
        )
    }

    @Test
    fun realtimeIdentifierWithoutProvider() {
        assertEquals("gpt-4o-mini", LlmModelInfo(model = "gpt-4o-mini").realtimeIdentifier)
    }
}
