package ai.inworld.voiceagent.realtime.events

import ai.inworld.voiceagent.realtime.SessionConfig
import ai.inworld.voiceagent.realtime.TurnDetectionConfig
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class SessionUpdateEvent(
    val type: String = "session.update",
    val session: Session,
) {
    @Serializable
    data class Session(
        val type: String = "realtime",
        val model: String,
        val instructions: String,
        val temperature: Double? = null,
        @SerialName("max_output_tokens") val maxOutputTokens: Int? = null,
        @SerialName("output_modalities") val outputModalities: List<String> = listOf("audio", "text"),
        val audio: Audio,
        val tools: List<Tool>? = null,
        // The one camelCase key in an otherwise snake_case schema — see EventJson.kt.
        @SerialName("providerData") val providerData: ProviderData? = null,
    )

    @Serializable
    data class Tool(
        val type: String,
        // Same camelCase exception as on Session.
        @SerialName("providerData") val providerData: ToolProviderData? = null,
    )

    @Serializable
    data class ToolProviderData(
        val engine: String,
        @SerialName("max_results") val maxResults: Int? = null,
        @SerialName("max_steps") val maxSteps: Int? = null,
    )

    @Serializable
    data class ProviderData(
        val backchannel: Backchannel? = null,
        val responsiveness: Responsiveness? = null,
    )

    @Serializable
    data class Backchannel(
        val enabled: Boolean = true,
        @SerialName("max_per_turn") val maxPerTurn: Int,
        @SerialName("min_gap_ms") val minGapMs: Int,
        @SerialName("min_speech_ms") val minSpeechMs: Int,
        @SerialName("volume_gain") val volumeGain: Double,
        @SerialName("decider_kind") val deciderKind: String,
        @SerialName("rule_fire_probability") val ruleFireProbability: Double? = null,
    )

    @Serializable
    data class Responsiveness(
        val enabled: Boolean = true,
        @SerialName("initial_wait_timeout_ms") val initialWaitTimeoutMs: Int,
        @SerialName("max_initial_per_turn") val maxInitialPerTurn: Int,
        @SerialName("min_filler_gap_ms") val minFillerGapMs: Int,
        @SerialName("max_tokens") val maxTokens: Int,
        @SerialName("enable_filler_on_first_assistant_reply") val enableFillerOnFirstAssistantReply: Boolean,
    )

    @Serializable
    data class Audio(
        val input: Input,
        val output: Output,
    )

    @Serializable
    data class Input(
        val transcription: Transcription? = null,
        @SerialName("noise_reduction") val noiseReduction: NoiseReduction? = null,
        @SerialName("turn_detection") val turnDetection: TurnDetection,
    )

    @Serializable
    data class Transcription(
        val model: String? = null,
        val language: String? = null,
    )

    @Serializable
    data class NoiseReduction(val type: String)

    @Serializable
    data class TurnDetection(
        val type: String,
        val eagerness: String? = null,
        @SerialName("create_response") val createResponse: Boolean,
        @SerialName("interrupt_response") val interruptResponse: Boolean,
    )

    @Serializable
    data class Output(
        val model: String,
        val voice: String,
        val speed: Double? = null,
    )

    companion object {
        fun from(config: SessionConfig): SessionUpdateEvent {
            val turnDetection = TurnDetection(
                type = "semantic_vad",
                eagerness = config.turnDetection.eagerness,
                createResponse = config.createResponse,
                interruptResponse = config.interruptResponse,
            )

            val transcription = if (config.transcriptionModel != null || config.transcriptionLanguage != null) {
                Transcription(model = config.transcriptionModel, language = config.transcriptionLanguage)
            } else null

            val backchannel = config.backchannel?.let {
                Backchannel(
                    maxPerTurn = it.maxPerTurn,
                    minGapMs = it.minGapMs,
                    minSpeechMs = it.minSpeechMs,
                    volumeGain = it.volumeGain,
                    deciderKind = it.deciderKind,
                    ruleFireProbability = if (it.deciderKind == "rule") it.ruleFireProbability else null,
                )
            }
            val responsiveness = config.responsiveness?.let {
                Responsiveness(
                    initialWaitTimeoutMs = it.initialWaitTimeoutMs,
                    maxInitialPerTurn = it.maxInitialPerTurn,
                    minFillerGapMs = it.minFillerGapMs,
                    maxTokens = it.maxTokens,
                    enableFillerOnFirstAssistantReply = it.enableOnFirstReply,
                )
            }
            val providerData = if (backchannel != null || responsiveness != null) {
                ProviderData(backchannel = backchannel, responsiveness = responsiveness)
            } else null

            val tools = config.webSearch?.let {
                listOf(Tool(
                    type = "web_search",
                    providerData = ToolProviderData(
                        engine = it.engine,
                        maxResults = it.maxResults,
                        maxSteps = it.maxSteps,
                    ),
                ))
            }

            return SessionUpdateEvent(
                session = Session(
                    model = config.model,
                    instructions = config.instructions,
                    temperature = config.temperature,
                    maxOutputTokens = config.maxOutputTokens,
                    tools = tools,
                    audio = Audio(
                        input = Input(
                            transcription = transcription,
                            noiseReduction = config.noiseReduction?.let(::NoiseReduction),
                            turnDetection = turnDetection,
                        ),
                        output = Output(
                            model = config.ttsModel,
                            voice = config.voice,
                            speed = config.speechSpeed,
                        ),
                    ),
                    providerData = providerData,
                )
            )
        }
    }
}

@Serializable
data class ConversationItemCreateEvent(val type: String = "conversation.item.create", val item: Item) {
    @Serializable
    data class Item(
        val type: String = "message",
        val role: String = "user",
        val content: List<Content>,
    )

    @Serializable
    data class Content(val type: String = "input_text", val text: String)

    companion object {
        fun userText(text: String) = ConversationItemCreateEvent(item = Item(content = listOf(Content(text = text))))
    }
}

@Serializable
data class ResponseCreateEvent(val type: String = "response.create")

@Serializable
data class ResponseCancelEvent(val type: String = "response.cancel")
