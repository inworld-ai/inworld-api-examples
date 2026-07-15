package ai.inworld.voiceagent

import ai.inworld.voiceagent.realtime.BackchannelConfig
import ai.inworld.voiceagent.realtime.ResponsivenessConfig
import ai.inworld.voiceagent.realtime.SessionConfig
import ai.inworld.voiceagent.realtime.TurnDetectionConfig
import ai.inworld.voiceagent.realtime.WebSearchConfig
import ai.inworld.voiceagent.realtime.events.ConversationItemCreateEvent
import ai.inworld.voiceagent.realtime.events.EventJson
import ai.inworld.voiceagent.realtime.events.ResponseCancelEvent
import ai.inworld.voiceagent.realtime.events.ResponseCreateEvent
import ai.inworld.voiceagent.realtime.events.SessionUpdateEvent
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ClientEventEncodingTest {
    private inline fun <reified T> encodeToObject(event: T): JsonObject =
        EventJson.parseToJsonElement(EventJson.encodeToString(event)).jsonObject

    private fun baseConfig() = SessionConfig(
        model = "openai/gpt-4o-mini",
        instructions = "Be brief.",
        ttsModel = "inworld-tts-2",
        voice = "Clive",
        greetingPrompt = "Say hello.",
    )

    private fun JsonObject.obj(key: String): JsonObject = getValue(key).jsonObject
    private fun JsonObject.str(key: String): String? = get(key)?.jsonPrimitive?.contentOrNull
    private fun JsonObject.int(key: String): Int? = get(key)?.jsonPrimitive?.intOrNull
    private fun JsonObject.double(key: String): Double? = get(key)?.jsonPrimitive?.doubleOrNull
    private fun JsonObject.bool(key: String): Boolean? = get(key)?.jsonPrimitive?.booleanOrNull

    @Test
    fun sessionUpdateDefaultShape() {
        val json = encodeToObject(SessionUpdateEvent.from(baseConfig()))

        assertEquals("session.update", json.str("type"))
        val session = json.obj("session")
        assertEquals("realtime", session.str("type"))
        assertEquals("openai/gpt-4o-mini", session.str("model"))
        assertEquals("Be brief.", session.str("instructions"))
        assertEquals(
            listOf("audio", "text"),
            session.getValue("output_modalities").jsonArray.map { it.jsonPrimitive.contentOrNull },
        )
        assertNull(session["temperature"])
        assertNull(session["max_output_tokens"])
        assertNull(session["tools"])

        val input = session.obj("audio").obj("input")
        assertNull(input["transcription"])
        assertNull(input["noise_reduction"])

        val turnDetection = input.obj("turn_detection")
        assertEquals("semantic_vad", turnDetection.str("type"))
        assertEquals("high", turnDetection.str("eagerness"))
        assertEquals(true, turnDetection.bool("create_response"))
        assertEquals(true, turnDetection.bool("interrupt_response"))
        assertNull(turnDetection["threshold"])

        val output = session.obj("audio").obj("output")
        assertEquals("inworld-tts-2", output.str("model"))
        assertEquals("Clive", output.str("voice"))
        assertNull(output["speed"])
    }

    @Test
    fun sessionUpdateWithWebSearchEncodesToolWithCamelCaseProviderData() {
        val config = baseConfig().copy(webSearch = WebSearchConfig())
        val raw = EventJson.encodeToString(SessionUpdateEvent.from(config))
        assertTrue(raw.contains("\"providerData\""))
        assertFalse(raw.contains("\"provider_data\""))

        val session = encodeToObject(SessionUpdateEvent.from(config)).obj("session")
        val tools = session.getValue("tools").jsonArray
        assertEquals(1, tools.size)
        val tool = tools[0].jsonObject
        assertEquals("web_search", tool.str("type"))
        val pd = tool.obj("providerData")
        assertEquals("google", pd.str("engine"))
        assertEquals(3, pd.int("max_results"))
        assertEquals(1, pd.int("max_steps"))
    }

    @Test
    fun sessionUpdateWithAllOptions() {
        val config = baseConfig().copy(
            temperature = 0.9,
            maxOutputTokens = 1024,
            speechSpeed = 1.25,
            transcriptionModel = "inworld/inworld-stt-1",
            transcriptionLanguage = "en",
            noiseReduction = "near_field",
            turnDetection = TurnDetectionConfig(eagerness = "low"),
            createResponse = false,
            interruptResponse = false,
        )

        val session = encodeToObject(SessionUpdateEvent.from(config)).obj("session")
        assertEquals(0.9, session.double("temperature")!!, 0.0)
        assertEquals(1024, session.int("max_output_tokens"))

        val input = session.obj("audio").obj("input")

        val transcription = input.obj("transcription")
        assertEquals("inworld/inworld-stt-1", transcription.str("model"))
        assertEquals("en", transcription.str("language"))

        assertEquals("near_field", input.obj("noise_reduction").str("type"))

        val turnDetection = input.obj("turn_detection")
        assertEquals("semantic_vad", turnDetection.str("type"))
        assertEquals("low", turnDetection.str("eagerness"))
        assertEquals(false, turnDetection.bool("create_response"))
        assertEquals(false, turnDetection.bool("interrupt_response"))

        assertEquals(1.25, session.obj("audio").obj("output").double("speed")!!, 0.0)
    }

    @Test
    fun providerDataOmittedByDefault() {
        val session = encodeToObject(SessionUpdateEvent.from(baseConfig())).obj("session")
        assertNull(session["providerData"])
        assertNull(session["provider_data"])
    }

    @Test
    fun providerDataKeyIsCamelCaseWhileInnerKeysAreSnakeCase() {
        val config = baseConfig().copy(
            backchannel = BackchannelConfig(
                maxPerTurn = 3, minGapMs = 4000, minSpeechMs = 800, volumeGain = 0.6,
                deciderKind = "llm", ruleFireProbability = 1.0,
            ),
        )
        // Assert the raw JSON string, since the camelCase exception is the whole point.
        val raw = EventJson.encodeToString(SessionUpdateEvent.from(config))
        assertTrue("providerData must stay camelCase", raw.contains("\"providerData\""))
        assertFalse("must not be snake_cased", raw.contains("\"provider_data\""))
        assertTrue("inner keys stay snake_case", raw.contains("\"max_per_turn\""))
        assertTrue(raw.contains("\"output_modalities\""))
    }

    @Test
    fun backchannelAndResponsivenessEncoding() {
        val config = baseConfig().copy(
            backchannel = BackchannelConfig(
                maxPerTurn = 2, minGapMs = 3000, minSpeechMs = 600, volumeGain = 0.5,
                deciderKind = "rule", ruleFireProbability = 0.25,
            ),
            responsiveness = ResponsivenessConfig(
                initialWaitTimeoutMs = 900, maxInitialPerTurn = 1, minFillerGapMs = 6000,
                maxTokens = 10, enableOnFirstReply = true,
            ),
        )

        val providerData = encodeToObject(SessionUpdateEvent.from(config)).obj("session").obj("providerData")

        val backchannel = providerData.obj("backchannel")
        assertEquals(true, backchannel.bool("enabled"))
        assertEquals(2, backchannel.int("max_per_turn"))
        assertEquals(3000, backchannel.int("min_gap_ms"))
        assertEquals(600, backchannel.int("min_speech_ms"))
        assertEquals(0.5, backchannel.double("volume_gain")!!, 0.0)
        assertEquals("rule", backchannel.str("decider_kind"))
        assertEquals(0.25, backchannel.double("rule_fire_probability")!!, 0.0)

        val responsiveness = providerData.obj("responsiveness")
        assertEquals(true, responsiveness.bool("enabled"))
        assertEquals(900, responsiveness.int("initial_wait_timeout_ms"))
        assertEquals(1, responsiveness.int("max_initial_per_turn"))
        assertEquals(6000, responsiveness.int("min_filler_gap_ms"))
        assertEquals(10, responsiveness.int("max_tokens"))
        assertEquals(true, responsiveness.bool("enable_filler_on_first_assistant_reply"))
    }

    @Test
    fun providerDataOnlyBackchannel() {
        val config = baseConfig().copy(
            backchannel = BackchannelConfig(
                maxPerTurn = 3, minGapMs = 4000, minSpeechMs = 800, volumeGain = 0.6,
                deciderKind = "llm", ruleFireProbability = 0.5,
            ),
        )
        val providerData = encodeToObject(SessionUpdateEvent.from(config)).obj("session").obj("providerData")
        // rule_fire_probability is omitted for the llm decider.
        assertNull(providerData.obj("backchannel")["rule_fire_probability"])
        assertNull(providerData["responsiveness"])
    }

    @Test
    fun conversationItemCreateShape() {
        val json = encodeToObject(ConversationItemCreateEvent.userText("Say hello."))
        assertEquals("conversation.item.create", json.str("type"))
        val item = json.obj("item")
        assertEquals("message", item.str("type"))
        assertEquals("user", item.str("role"))
        val content = item.getValue("content").jsonArray
        assertEquals(1, content.size)
        assertEquals("input_text", content[0].jsonObject.str("type"))
        assertEquals("Say hello.", content[0].jsonObject.str("text"))
    }

    @Test
    fun responseCreateAndCancel() {
        assertEquals("response.create", encodeToObject(ResponseCreateEvent()).str("type"))
        assertEquals("response.cancel", encodeToObject(ResponseCancelEvent()).str("type"))
    }
}
