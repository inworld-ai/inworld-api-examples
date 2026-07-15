package ai.inworld.voiceagent.storage

import ai.inworld.voiceagent.audio.AudioDebugConfig
import ai.inworld.voiceagent.audio.AudioMode
import ai.inworld.voiceagent.auth.AuthProvider
import ai.inworld.voiceagent.auth.BackendJwtAuthProvider
import ai.inworld.voiceagent.auth.BasicAuthProvider
import ai.inworld.voiceagent.realtime.BackchannelConfig
import ai.inworld.voiceagent.realtime.ResponsivenessConfig
import ai.inworld.voiceagent.realtime.SessionConfig
import ai.inworld.voiceagent.realtime.TurnDetectionConfig
import ai.inworld.voiceagent.realtime.WebSearchConfig

enum class AuthMode(val label: String) {
    Basic("API Key (Basic)"),
    BackendJwt("Backend JWT"),
}

enum class NoiseReductionMode(val wire: String?, val label: String) {
    Off(null, "Server default"),
    NearField("near_field", "Near field"),
    FarField("far_field", "Far field"),
}

enum class DeciderKind(val wire: String) {
    Llm("llm"),
    Rule("rule");

    val label: String get() = wire.uppercase()
}

object SettingsCatalog {
    val eagernessOptions = listOf("low", "medium", "high", "auto")
    val transcriptionModels = listOf(
        "", // server default
        "inworld/inworld-stt-1",
        "assemblyai/u3-rt-pro",
        "soniox/stt-rt-v4",
    )
}

data class Settings(
    val apiKey: String = "",

    // Model
    val model: String = "inworld/models/gemma-4-26b-a4b-it",
    val instructions: String = "You are a friendly voice assistant. Keep responses brief.",
    val greetingPrompt: String = "Say hello and ask how you can help. One sentence max.",
    val temperatureEnabled: Boolean = false,
    val temperature: Double = 0.7,
    /** 0 means "server default" (not sent). */
    val maxOutputTokens: Int = 0,
    val webSearchEnabled: Boolean = true,

    // Voice output
    val ttsModel: String = "inworld-tts-2",
    val voice: String = "Clive",
    val speechSpeed: Double = 1.0,

    // Audio input
    val transcriptionModel: String = "",
    val transcriptionLanguage: String = "",
    val noiseReduction: NoiseReductionMode = NoiseReductionMode.Off,

    // Turn detection
    val eagerness: String = "high",
    val createResponse: Boolean = true,
    val interruptResponse: Boolean = true,

    // Back-channel (providerData.backchannel)
    val backchannelEnabled: Boolean = true,
    val bcMaxPerTurn: Int = 3,
    val bcMinGapMs: Int = 4000,
    val bcMinSpeechMs: Int = 800,
    val bcVolumeGain: Double = 0.6,
    val bcDeciderKind: DeciderKind = DeciderKind.Llm,
    val bcRuleFireProbability: Double = 1.0,

    // Responsiveness (providerData.responsiveness)
    val responsivenessEnabled: Boolean = true,
    val respInitialWaitMs: Int = 1200,
    val respMaxInitialPerTurn: Int = 1,
    val respMinFillerGapMs: Int = 8000,
    val respMaxTokens: Int = 12,
    val respEnableOnFirstReply: Boolean = false,

    // Audio engineering (debug) — echo/AEC experiments
    val useHardwareAec: Boolean = true,
    val audioMode: AudioMode = AudioMode.InCommunication,

    // Auth
    val authMode: AuthMode = AuthMode.Basic,
    val backendUrl: String = "http://localhost:3000",
) {
    fun makeSessionConfig(): SessionConfig {
        val turnDetection = TurnDetectionConfig(eagerness)
        return SessionConfig(
            model = model,
            instructions = instructions,
            temperature = temperature.takeIf { temperatureEnabled },
            maxOutputTokens = maxOutputTokens.takeIf { it > 0 },
            ttsModel = ttsModel,
            voice = voice,
            speechSpeed = speechSpeed.coerceIn(0.5, 1.5).takeIf { it != 1.0 },
            transcriptionModel = transcriptionModel.takeIf { it.isNotEmpty() },
            transcriptionLanguage = transcriptionLanguage.takeIf { it.isNotEmpty() },
            noiseReduction = noiseReduction.wire,
            turnDetection = turnDetection,
            webSearch = if (webSearchEnabled) WebSearchConfig() else null,
            createResponse = createResponse,
            interruptResponse = interruptResponse,
            backchannel = if (backchannelEnabled) BackchannelConfig(
                maxPerTurn = bcMaxPerTurn,
                minGapMs = bcMinGapMs,
                minSpeechMs = bcMinSpeechMs,
                volumeGain = bcVolumeGain,
                deciderKind = bcDeciderKind.wire,
                ruleFireProbability = bcRuleFireProbability,
            ) else null,
            responsiveness = if (responsivenessEnabled) ResponsivenessConfig(
                initialWaitTimeoutMs = respInitialWaitMs,
                maxInitialPerTurn = respMaxInitialPerTurn,
                minFillerGapMs = respMinFillerGapMs,
                maxTokens = respMaxTokens,
                enableOnFirstReply = respEnableOnFirstReply,
            ) else null,
            greetingPrompt = greetingPrompt,
        )
    }

    fun makeAudioDebugConfig() = AudioDebugConfig(useHardwareAec = useHardwareAec, mode = audioMode)

    fun makeAuthProvider(): AuthProvider = when (authMode) {
        AuthMode.Basic -> BasicAuthProvider(apiKey)
        AuthMode.BackendJwt -> BackendJwtAuthProvider(backendUrl)
    }
}
