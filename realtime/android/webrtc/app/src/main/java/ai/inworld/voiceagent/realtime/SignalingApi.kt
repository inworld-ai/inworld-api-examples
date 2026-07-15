package ai.inworld.voiceagent.realtime

import ai.inworld.voiceagent.auth.IceServer
import ai.inworld.voiceagent.auth.RealtimeCredentials
import ai.inworld.voiceagent.realtime.events.EventJson
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

class SignalingApi(private val credentials: RealtimeCredentials) {
    @Serializable
    private data class IceServersResponse(
        @SerialName("ice_servers") val iceServers: List<IceServer> = emptyList(),
    )

    suspend fun fetchIceServers(): List<IceServer> {
        credentials.preFetchedIceServers?.let { return it }
        val text = Http.request(
            url = "${credentials.apiBaseUrl}/v1/realtime/ice-servers",
            headers = mapOf("Authorization" to credentials.authorizationHeader),
        )
        return EventJson.decodeFromString<IceServersResponse>(text).iceServers
    }

    suspend fun postOffer(sdp: String): String {
        val url = credentials.callsUrl ?: "${credentials.apiBaseUrl}/v1/realtime/calls"
        val answer = Http.request(
            url = url,
            method = "POST",
            headers = mapOf(
                "Authorization" to credentials.authorizationHeader,
                "Content-Type" to "application/sdp",
            ),
            body = sdp.toByteArray(),
        )
        require(answer.isNotEmpty()) { "Malformed response from Inworld API." }
        return answer
    }
}
