package ai.inworld.voiceagent.realtime

import ai.inworld.voiceagent.auth.RealtimeCredentials
import ai.inworld.voiceagent.realtime.events.EventJson
import kotlinx.serialization.Serializable

@Serializable
data class LlmModelInfo(
    val model: String,
    val provider: String? = null,
    val modelCreator: String? = null,
    val isSupported: Boolean? = null,
) {
    /** Realtime API expects a `provider/model` identifier, while list-models returns them
     *  separately. The model string may itself contain slashes, so prefix the provider
     *  unconditionally unless it is already present. */
    val realtimeIdentifier: String
        get() = when {
            provider.isNullOrEmpty() -> model
            model.startsWith("$provider/") -> model
            else -> "$provider/$model"
        }
}

@Serializable
data class VoiceInfo(
    val voiceId: String,
    val displayName: String? = null,
    val langCode: String? = null,
    val description: String? = null,
    val gender: String? = null,
    val source: String? = null,
)

class CatalogApi(private val credentials: RealtimeCredentials) {
    @Serializable
    private data class ModelsResponse(val models: List<LlmModelInfo>? = null)

    @Serializable
    private data class VoicesResponse(
        val voices: List<VoiceInfo>? = null,
        val nextPageToken: String? = null,
    )

    suspend fun fetchModels(): List<LlmModelInfo> {
        val text = get("${credentials.apiBaseUrl}/llm/v1alpha/models")
        return (EventJson.decodeFromString<ModelsResponse>(text).models ?: emptyList())
            .sortedBy { it.realtimeIdentifier }
    }

    suspend fun fetchVoices(): List<VoiceInfo> {
        val voices = mutableListOf<VoiceInfo>()
        var pageToken: String? = null
        do {
            var url = "${credentials.apiBaseUrl}/voices/v1/voices?pageSize=2000"
            pageToken?.let { url += "&pageToken=$it" }
            val page = EventJson.decodeFromString<VoicesResponse>(get(url))
            voices += page.voices ?: emptyList()
            pageToken = page.nextPageToken?.takeIf { it.isNotEmpty() }
        } while (pageToken != null)
        return voices.sortedBy { it.displayName ?: it.voiceId }
    }

    private suspend fun get(url: String): String =
        Http.request(url, headers = mapOf("Authorization" to credentials.authorizationHeader))
}
