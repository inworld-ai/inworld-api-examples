package ai.inworld.voiceagent.auth

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonTransformingSerializer

/** "urls" may arrive as a single string or an array of strings. */
private object UrlsSerializer : JsonTransformingSerializer<List<String>>(ListSerializer(String.serializer())) {
    override fun transformDeserialize(element: JsonElement): JsonElement =
        if (element is JsonPrimitive) JsonArray(listOf(element)) else element
}

@Serializable
data class IceServer(
    @Serializable(with = UrlsSerializer::class) val urls: List<String>,
    val username: String? = null,
    val credential: String? = null,
)

data class RealtimeCredentials(
    val authorizationHeader: String,
    val apiBaseUrl: String = "https://api.inworld.ai",
    val callsUrl: String? = null,
    val preFetchedIceServers: List<IceServer>? = null,
)

sealed class AuthException(message: String) : Exception(message) {
    class MissingApiKey : AuthException("Inworld API key is not set. Add it in Settings.")
    class InvalidBackendUrl : AuthException("Backend URL is invalid.")
    class BackendRequestFailed(detail: String) : AuthException("Backend config request failed: $detail")
}

fun interface AuthProvider {
    suspend fun credentials(): RealtimeCredentials
}
