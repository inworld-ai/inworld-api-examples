package ai.inworld.voiceagent.auth

import ai.inworld.voiceagent.realtime.Http
import ai.inworld.voiceagent.realtime.events.EventJson
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.net.URL

/** Fetches a short-lived JWT from a trusted backend (the JS example's `webrtc/jwt`
 *  Node server) so no Inworld key/secret ships in the app. */
class BackendJwtAuthProvider(private val backendUrl: String) : AuthProvider {
    @Serializable
    private data class ConfigResponse(
        val jwt: String,
        @SerialName("ice_servers") val iceServers: List<IceServer>? = null,
        val url: String? = null,
    )

    override suspend fun credentials(): RealtimeCredentials {
        val base = backendUrl.trim().trimEnd('/')
        if (base.isEmpty() || runCatching { URL(base) }.isFailure) throw AuthException.InvalidBackendUrl()

        val text = runCatching { Http.request("$base/api/config") }
            .getOrElse { throw AuthException.BackendRequestFailed(it.message ?: "request failed") }
        val config = runCatching { EventJson.decodeFromString<ConfigResponse>(text) }
            .getOrElse { throw AuthException.BackendRequestFailed("invalid config payload") }

        val callsUrl = config.url?.takeIf { it.isNotEmpty() }?.also {
            if (runCatching { URL(it) }.isFailure) {
                throw AuthException.BackendRequestFailed("backend returned an invalid calls url: $it")
            }
        }
        return RealtimeCredentials(
            authorizationHeader = "Bearer ${config.jwt}",
            callsUrl = callsUrl,
            preFetchedIceServers = config.iceServers,
        )
    }
}
