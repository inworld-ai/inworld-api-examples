package ai.inworld.voiceagent.state

import java.util.UUID

enum class Role { User, Agent }

data class TranscriptItem(
    val id: String = UUID.randomUUID().toString(),
    val role: Role,
    val text: String,
    val isStreaming: Boolean = false,
)
