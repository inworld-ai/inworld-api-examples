package ai.inworld.voiceagent.realtime.events

import kotlinx.serialization.json.Json

/// The realtime session schema is snake_case everywhere EXCEPT the single key
/// `providerData`, which the Go server unmarshals as camelCase (`json:"providerData"`).
/// A global JsonNamingStrategy.SnakeCase would emit `provider_data`, which the server
/// silently ignores — so back-channel and responsiveness never turn on. Hence explicit
/// @SerialName on every multi-word field instead of a naming strategy.
val EventJson = Json {
    encodeDefaults = true
    explicitNulls = false
    ignoreUnknownKeys = true
}
