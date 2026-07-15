package ai.inworld.voiceagent.storage

import ai.inworld.voiceagent.Secrets
import ai.inworld.voiceagent.audio.AudioMode
import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "settings")

private inline fun <reified E : Enum<E>> enumOf(name: String?, fallback: E): E =
    name?.let { n -> enumValues<E>().firstOrNull { it.name == n } } ?: fallback

/// The API key is stored in plain Preferences DataStore: EncryptedSharedPreferences is
/// deprecated/abandoned, and for a demo the Keystore-cipher dance isn't worth the noise.
class SettingsRepository(private val context: Context) {
    private object Keys {
        val apiKey = stringPreferencesKey("apiKey")
        val model = stringPreferencesKey("model")
        val instructions = stringPreferencesKey("instructions")
        val greetingPrompt = stringPreferencesKey("greetingPrompt")
        val temperatureEnabled = booleanPreferencesKey("temperatureEnabled")
        val temperature = doublePreferencesKey("temperature")
        val maxOutputTokens = intPreferencesKey("maxOutputTokens")
        val webSearchEnabled = booleanPreferencesKey("webSearchEnabled")
        val ttsModel = stringPreferencesKey("ttsModel")
        val voice = stringPreferencesKey("voice")
        val speechSpeed = doublePreferencesKey("speechSpeed")
        val transcriptionModel = stringPreferencesKey("transcriptionModel")
        val transcriptionLanguage = stringPreferencesKey("transcriptionLanguage")
        val noiseReduction = stringPreferencesKey("noiseReduction")
        val eagerness = stringPreferencesKey("eagerness")
        val createResponse = booleanPreferencesKey("createResponse")
        val interruptResponse = booleanPreferencesKey("interruptResponse")
        val backchannelEnabled = booleanPreferencesKey("backchannelEnabled")
        val bcMaxPerTurn = intPreferencesKey("bcMaxPerTurn")
        val bcMinGapMs = intPreferencesKey("bcMinGapMs")
        val bcMinSpeechMs = intPreferencesKey("bcMinSpeechMs")
        val bcVolumeGain = doublePreferencesKey("bcVolumeGain")
        val bcDeciderKind = stringPreferencesKey("bcDeciderKind")
        val bcRuleFireProbability = doublePreferencesKey("bcRuleFireProbability")
        val responsivenessEnabled = booleanPreferencesKey("responsivenessEnabled")
        val respInitialWaitMs = intPreferencesKey("respInitialWaitMs")
        val respMaxInitialPerTurn = intPreferencesKey("respMaxInitialPerTurn")
        val respMinFillerGapMs = intPreferencesKey("respMinFillerGapMs")
        val respMaxTokens = intPreferencesKey("respMaxTokens")
        val respEnableOnFirstReply = booleanPreferencesKey("respEnableOnFirstReply")
        val useHardwareAec = booleanPreferencesKey("useHardwareAec")
        val audioMode = stringPreferencesKey("audioMode")
        val authMode = stringPreferencesKey("authMode")
        val backendUrl = stringPreferencesKey("backendUrl")
    }

    val settings: Flow<Settings> = context.dataStore.data.map(::toSettings)

    suspend fun current(): Settings = settings.first()

    suspend fun update(transform: (Settings) -> Settings) {
        context.dataStore.edit { prefs ->
            val next = transform(toSettings(prefs))
            prefs[Keys.apiKey] = next.apiKey
            prefs[Keys.model] = next.model
            prefs[Keys.instructions] = next.instructions
            prefs[Keys.greetingPrompt] = next.greetingPrompt
            prefs[Keys.temperatureEnabled] = next.temperatureEnabled
            prefs[Keys.temperature] = next.temperature
            prefs[Keys.maxOutputTokens] = next.maxOutputTokens
            prefs[Keys.webSearchEnabled] = next.webSearchEnabled
            prefs[Keys.ttsModel] = next.ttsModel
            prefs[Keys.voice] = next.voice
            prefs[Keys.speechSpeed] = next.speechSpeed
            prefs[Keys.transcriptionModel] = next.transcriptionModel
            prefs[Keys.transcriptionLanguage] = next.transcriptionLanguage
            prefs[Keys.noiseReduction] = next.noiseReduction.name
            prefs[Keys.eagerness] = next.eagerness
            prefs[Keys.createResponse] = next.createResponse
            prefs[Keys.interruptResponse] = next.interruptResponse
            prefs[Keys.backchannelEnabled] = next.backchannelEnabled
            prefs[Keys.bcMaxPerTurn] = next.bcMaxPerTurn
            prefs[Keys.bcMinGapMs] = next.bcMinGapMs
            prefs[Keys.bcMinSpeechMs] = next.bcMinSpeechMs
            prefs[Keys.bcVolumeGain] = next.bcVolumeGain
            prefs[Keys.bcDeciderKind] = next.bcDeciderKind.name
            prefs[Keys.bcRuleFireProbability] = next.bcRuleFireProbability
            prefs[Keys.responsivenessEnabled] = next.responsivenessEnabled
            prefs[Keys.respInitialWaitMs] = next.respInitialWaitMs
            prefs[Keys.respMaxInitialPerTurn] = next.respMaxInitialPerTurn
            prefs[Keys.respMinFillerGapMs] = next.respMinFillerGapMs
            prefs[Keys.respMaxTokens] = next.respMaxTokens
            prefs[Keys.respEnableOnFirstReply] = next.respEnableOnFirstReply
            prefs[Keys.useHardwareAec] = next.useHardwareAec
            prefs[Keys.audioMode] = next.audioMode.name
            prefs[Keys.authMode] = next.authMode.name
            prefs[Keys.backendUrl] = next.backendUrl
        }
    }

    private fun toSettings(prefs: Preferences): Settings {
        val defaults = Settings(apiKey = Secrets.INWORLD_API_KEY)
        return Settings(
            apiKey = prefs[Keys.apiKey] ?: defaults.apiKey,
            model = prefs[Keys.model] ?: defaults.model,
            instructions = prefs[Keys.instructions] ?: defaults.instructions,
            greetingPrompt = prefs[Keys.greetingPrompt] ?: defaults.greetingPrompt,
            temperatureEnabled = prefs[Keys.temperatureEnabled] ?: defaults.temperatureEnabled,
            temperature = prefs[Keys.temperature] ?: defaults.temperature,
            maxOutputTokens = prefs[Keys.maxOutputTokens] ?: defaults.maxOutputTokens,
            webSearchEnabled = prefs[Keys.webSearchEnabled] ?: defaults.webSearchEnabled,
            ttsModel = prefs[Keys.ttsModel] ?: defaults.ttsModel,
            voice = prefs[Keys.voice] ?: defaults.voice,
            speechSpeed = (prefs[Keys.speechSpeed] ?: defaults.speechSpeed)
                .takeIf { it in 0.5..1.5 } ?: defaults.speechSpeed,
            transcriptionModel = prefs[Keys.transcriptionModel] ?: defaults.transcriptionModel,
            transcriptionLanguage = prefs[Keys.transcriptionLanguage] ?: defaults.transcriptionLanguage,
            noiseReduction = enumOf(prefs[Keys.noiseReduction], defaults.noiseReduction),
            eagerness = prefs[Keys.eagerness] ?: defaults.eagerness,
            createResponse = prefs[Keys.createResponse] ?: defaults.createResponse,
            interruptResponse = prefs[Keys.interruptResponse] ?: defaults.interruptResponse,
            backchannelEnabled = prefs[Keys.backchannelEnabled] ?: defaults.backchannelEnabled,
            bcMaxPerTurn = prefs[Keys.bcMaxPerTurn] ?: defaults.bcMaxPerTurn,
            bcMinGapMs = prefs[Keys.bcMinGapMs] ?: defaults.bcMinGapMs,
            bcMinSpeechMs = prefs[Keys.bcMinSpeechMs] ?: defaults.bcMinSpeechMs,
            bcVolumeGain = prefs[Keys.bcVolumeGain] ?: defaults.bcVolumeGain,
            bcDeciderKind = enumOf(prefs[Keys.bcDeciderKind], defaults.bcDeciderKind),
            bcRuleFireProbability = prefs[Keys.bcRuleFireProbability] ?: defaults.bcRuleFireProbability,
            responsivenessEnabled = prefs[Keys.responsivenessEnabled] ?: defaults.responsivenessEnabled,
            respInitialWaitMs = prefs[Keys.respInitialWaitMs] ?: defaults.respInitialWaitMs,
            respMaxInitialPerTurn = prefs[Keys.respMaxInitialPerTurn] ?: defaults.respMaxInitialPerTurn,
            respMinFillerGapMs = prefs[Keys.respMinFillerGapMs] ?: defaults.respMinFillerGapMs,
            respMaxTokens = prefs[Keys.respMaxTokens] ?: defaults.respMaxTokens,
            respEnableOnFirstReply = prefs[Keys.respEnableOnFirstReply] ?: defaults.respEnableOnFirstReply,
            useHardwareAec = prefs[Keys.useHardwareAec] ?: defaults.useHardwareAec,
            audioMode = enumOf(prefs[Keys.audioMode], defaults.audioMode),
            authMode = enumOf(prefs[Keys.authMode], defaults.authMode),
            backendUrl = prefs[Keys.backendUrl] ?: defaults.backendUrl,
        )
    }
}
