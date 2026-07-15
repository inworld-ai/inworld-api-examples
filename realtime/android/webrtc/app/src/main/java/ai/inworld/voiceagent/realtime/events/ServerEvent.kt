package ai.inworld.voiceagent.realtime.events

import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

sealed interface ServerEvent {
    data class OutputTextDelta(val delta: String) : ServerEvent
    data class TranscriptDone(val transcript: String?) : ServerEvent
    data class InputTranscriptionDelta(val delta: String) : ServerEvent
    data class InputTranscriptionCompleted(val transcript: String) : ServerEvent
    data object SpeechStarted : ServerEvent
    data object OutputItemAdded : ServerEvent
    data object ResponseDone : ServerEvent
    data class BackchannelAudioDelta(val base64Pcm16: String) : ServerEvent
    data class BackchannelAudioDone(val phrase: String?) : ServerEvent
    data class BackchannelSkipped(val reason: String) : ServerEvent
    data class Error(val message: String) : ServerEvent
    data class Unknown(val type: String) : ServerEvent

    companion object {
        fun decode(text: String): ServerEvent {
            val obj = runCatching { EventJson.parseToJsonElement(text).jsonObject }.getOrNull()
                ?: return Unknown("")
            val type = obj["type"]?.jsonPrimitive?.contentOrNull ?: return Unknown("")

            fun str(key: String): String? =
                runCatching { obj[key]?.jsonPrimitive?.contentOrNull }.getOrNull()

            return when (type) {
                "response.output_text.delta",
                "response.text.delta",
                "response.audio_transcript.delta",
                "response.output_audio_transcript.delta",
                -> OutputTextDelta(str("delta") ?: "")

                "response.output_audio_transcript.done" -> TranscriptDone(str("transcript"))

                "response.content_part.done" -> {
                    val part = runCatching { obj["part"]?.jsonObject }.getOrNull()
                    TranscriptDone(runCatching { part?.get("transcript")?.jsonPrimitive?.contentOrNull }.getOrNull())
                }

                "conversation.item.input_audio_transcription.delta" ->
                    InputTranscriptionDelta(str("delta") ?: "")

                "conversation.item.input_audio_transcription.completed" ->
                    InputTranscriptionCompleted(str("transcript") ?: "")

                "input_audio_buffer.speech_started" -> SpeechStarted
                "response.output_item.added" -> OutputItemAdded
                "response.done" -> ResponseDone

                "response.backchannel.audio.delta" -> BackchannelAudioDelta(str("delta") ?: "")
                "response.backchannel.audio.done" -> BackchannelAudioDone(str("phrase"))
                "response.backchannel.skipped" -> BackchannelSkipped(str("reason") ?: "")

                "error" -> {
                    val error = runCatching { obj["error"]?.jsonObject }.getOrNull()
                    val message = runCatching { error?.get("message")?.jsonPrimitive?.contentOrNull }.getOrNull()
                        ?: str("message")
                        ?: "unknown error"
                    Error(message)
                }

                else -> Unknown(type)
            }
        }
    }
}
