package ai.inworld.voiceagent.state

sealed interface SessionState {
    data object Idle : SessionState
    data object Connecting : SessionState
    data object Connected : SessionState
    data class Failed(val message: String) : SessionState
}
