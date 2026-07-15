package ai.inworld.voiceagent.auth

/** The key from Settings is already base64 — sent verbatim after "Basic". */
class BasicAuthProvider(private val apiKey: String) : AuthProvider {
    override suspend fun credentials(): RealtimeCredentials {
        val key = apiKey.trim()
        if (key.isEmpty()) throw AuthException.MissingApiKey()
        return RealtimeCredentials(authorizationHeader = "Basic $key")
    }
}
