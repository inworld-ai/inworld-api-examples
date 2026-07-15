package ai.inworld.voiceagent.realtime

data class TurnDetectionConfig(val eagerness: String)

data class WebSearchConfig(
    val engine: String = "google",
    val maxResults: Int = 3,
    val maxSteps: Int = 1,
)

data class BackchannelConfig(
    val maxPerTurn: Int,
    val minGapMs: Int,
    val minSpeechMs: Int,
    val volumeGain: Double,
    val deciderKind: String,
    val ruleFireProbability: Double,
)

data class ResponsivenessConfig(
    val initialWaitTimeoutMs: Int,
    val maxInitialPerTurn: Int,
    val minFillerGapMs: Int,
    val maxTokens: Int,
    val enableOnFirstReply: Boolean,
)

data class SessionConfig(
    val model: String,
    val instructions: String,
    val temperature: Double? = null,
    val maxOutputTokens: Int? = null,
    val ttsModel: String,
    val voice: String,
    val speechSpeed: Double? = null,
    val transcriptionModel: String? = null,
    val transcriptionLanguage: String? = null,
    val noiseReduction: String? = null,
    val turnDetection: TurnDetectionConfig = TurnDetectionConfig(eagerness = "high"),
    val webSearch: WebSearchConfig? = null,
    val createResponse: Boolean = true,
    val interruptResponse: Boolean = true,
    val backchannel: BackchannelConfig? = null,
    val responsiveness: ResponsivenessConfig? = null,
    val greetingPrompt: String,
)
