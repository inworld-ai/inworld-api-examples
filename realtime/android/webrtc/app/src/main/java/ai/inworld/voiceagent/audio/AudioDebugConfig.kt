package ai.inworld.voiceagent.audio

/** Android analog of iOS `.voiceChat` vs `.default` — IN_COMMUNICATION engages the
 *  voice-call path (and hardware AEC); NORMAL disables it, for echo repro. */
enum class AudioMode(val label: String) {
    InCommunication("IN_COMMUNICATION (voice call)"),
    Normal("NORMAL (no voice processing)"),
}

data class AudioDebugConfig(
    val useHardwareAec: Boolean = true,
    val mode: AudioMode = AudioMode.InCommunication,
)
