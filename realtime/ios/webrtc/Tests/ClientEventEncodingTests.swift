import XCTest
@testable import InworldVoiceAgent

final class ClientEventEncodingTests: XCTestCase {
    private func encodeToDictionary(_ event: some Encodable) throws -> [String: Any] {
        let data = try ClientEventEncoder.encode(event)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func makeBaseConfig() -> SessionConfig {
        SessionConfig(
            model: "openai/gpt-4o-mini",
            instructions: "Be brief.",
            ttsModel: "inworld-tts-2",
            voice: "Clive",
            greetingPrompt: "Say hello."
        )
    }

    func testSessionUpdateWithWebSearchEncodesToolWithCamelCaseProviderData() throws {
        var config = makeBaseConfig()
        config.webSearch = SessionConfig.WebSearchConfig()

        let data = try ClientEventEncoder.encode(SessionUpdateEvent(config: config))
        let raw = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertTrue(raw.contains("\"providerData\""))
        XCTAssertFalse(raw.contains("\"provider_data\""))

        let json = try encodeToDictionary(SessionUpdateEvent(config: config))
        let session = try XCTUnwrap(json["session"] as? [String: Any])
        let tools = try XCTUnwrap(session["tools"] as? [[String: Any]])
        XCTAssertEqual(tools.count, 1)
        XCTAssertEqual(tools[0]["type"] as? String, "web_search")
        let pd = try XCTUnwrap(tools[0]["providerData"] as? [String: Any])
        XCTAssertEqual(pd["engine"] as? String, "google")
        XCTAssertEqual(pd["max_results"] as? Int, 3)
        XCTAssertEqual(pd["max_steps"] as? Int, 1)
    }

    func testSessionUpdateDefaultShape() throws {
        let json = try encodeToDictionary(SessionUpdateEvent(config: makeBaseConfig()))

        XCTAssertEqual(json["type"] as? String, "session.update")
        let session = try XCTUnwrap(json["session"] as? [String: Any])
        XCTAssertEqual(session["type"] as? String, "realtime")
        XCTAssertEqual(session["model"] as? String, "openai/gpt-4o-mini")
        XCTAssertEqual(session["instructions"] as? String, "Be brief.")
        XCTAssertEqual(session["output_modalities"] as? [String], ["audio", "text"])
        XCTAssertNil(session["temperature"])
        XCTAssertNil(session["max_output_tokens"])

        let audio = try XCTUnwrap(session["audio"] as? [String: Any])
        let input = try XCTUnwrap(audio["input"] as? [String: Any])
        XCTAssertNil(input["transcription"])
        XCTAssertNil(input["noise_reduction"])

        let turnDetection = try XCTUnwrap(input["turn_detection"] as? [String: Any])
        XCTAssertEqual(turnDetection["type"] as? String, "semantic_vad")
        XCTAssertEqual(turnDetection["eagerness"] as? String, "high")
        XCTAssertEqual(turnDetection["create_response"] as? Bool, true)
        XCTAssertEqual(turnDetection["interrupt_response"] as? Bool, true)
        XCTAssertNil(turnDetection["threshold"])

        let output = try XCTUnwrap(audio["output"] as? [String: Any])
        XCTAssertEqual(output["model"] as? String, "inworld-tts-2")
        XCTAssertEqual(output["voice"] as? String, "Clive")
        XCTAssertNil(output["speed"])
    }

    func testSessionUpdateWithAllOptions() throws {
        var config = makeBaseConfig()
        config.temperature = 0.9
        config.maxOutputTokens = 1024
        config.speechSpeed = 1.25
        config.transcriptionModel = "inworld/inworld-stt-1"
        config.transcriptionLanguage = "en"
        config.noiseReduction = "near_field"
        config.turnDetection = .serverVAD(
            threshold: 0.6,
            prefixPaddingMs: 300,
            silenceDurationMs: 700,
            idleTimeoutMs: 5000
        )
        config.createResponse = false
        config.interruptResponse = false

        let json = try encodeToDictionary(SessionUpdateEvent(config: config))
        let session = try XCTUnwrap(json["session"] as? [String: Any])
        XCTAssertEqual(session["temperature"] as? Double, 0.9)
        XCTAssertEqual(session["max_output_tokens"] as? Int, 1024)

        let audio = try XCTUnwrap(session["audio"] as? [String: Any])
        let input = try XCTUnwrap(audio["input"] as? [String: Any])

        let transcription = try XCTUnwrap(input["transcription"] as? [String: Any])
        XCTAssertEqual(transcription["model"] as? String, "inworld/inworld-stt-1")
        XCTAssertEqual(transcription["language"] as? String, "en")

        let noiseReduction = try XCTUnwrap(input["noise_reduction"] as? [String: Any])
        XCTAssertEqual(noiseReduction["type"] as? String, "near_field")

        let turnDetection = try XCTUnwrap(input["turn_detection"] as? [String: Any])
        XCTAssertEqual(turnDetection["type"] as? String, "server_vad")
        XCTAssertEqual(turnDetection["threshold"] as? Double, 0.6)
        XCTAssertEqual(turnDetection["prefix_padding_ms"] as? Int, 300)
        XCTAssertEqual(turnDetection["silence_duration_ms"] as? Int, 700)
        XCTAssertEqual(turnDetection["idle_timeout_ms"] as? Int, 5000)
        XCTAssertEqual(turnDetection["create_response"] as? Bool, false)
        XCTAssertEqual(turnDetection["interrupt_response"] as? Bool, false)
        XCTAssertNil(turnDetection["eagerness"])

        let output = try XCTUnwrap(audio["output"] as? [String: Any])
        XCTAssertEqual(output["speed"] as? Double, 1.25)
    }

    func testSettingsStoreSessionConfigOmitsDefaults() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let settings = SettingsStore(defaults: defaults)
        let config = settings.makeSessionConfig()

        XCTAssertNil(config.temperature)
        XCTAssertNil(config.maxOutputTokens)
        XCTAssertNil(config.speechSpeed)
        XCTAssertNil(config.transcriptionModel)
        XCTAssertNil(config.transcriptionLanguage)
        XCTAssertNil(config.noiseReduction)
        if case .semanticVAD(let eagerness) = config.turnDetection {
            XCTAssertEqual(eagerness, "high")
        } else {
            XCTFail("expected semantic VAD by default")
        }
    }

    func testProviderDataOmittedByDefault() throws {
        let json = try encodeToDictionary(SessionUpdateEvent(config: makeBaseConfig()))
        let session = try XCTUnwrap(json["session"] as? [String: Any])
        XCTAssertNil(session["providerData"])
        XCTAssertNil(session["provider_data"])
    }

    func testProviderDataKeyIsCamelCaseWhileInnerKeysAreSnakeCase() throws {
        var config = makeBaseConfig()
        config.backchannel = SessionConfig.BackchannelConfig(
            maxPerTurn: 3, minGapMs: 4000, minSpeechMs: 800, volumeGain: 0.6,
            deciderKind: "llm", ruleFireProbability: 1.0
        )
        // Assert the raw JSON string, since the camelCase exception is the whole point.
        let data = try ClientEventEncoder.encode(SessionUpdateEvent(config: config))
        let raw = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(raw.contains("\"providerData\""), "providerData must stay camelCase")
        XCTAssertFalse(raw.contains("\"provider_data\""), "must not be snake_cased")
        XCTAssertTrue(raw.contains("\"max_per_turn\""), "inner keys stay snake_case")
        XCTAssertTrue(raw.contains("\"output_modalities\""))
    }

    func testBackchannelAndResponsivenessEncoding() throws {
        var config = makeBaseConfig()
        config.backchannel = SessionConfig.BackchannelConfig(
            maxPerTurn: 2, minGapMs: 3000, minSpeechMs: 600, volumeGain: 0.5,
            deciderKind: "rule", ruleFireProbability: 0.25
        )
        config.responsiveness = SessionConfig.ResponsivenessConfig(
            initialWaitTimeoutMs: 900, maxInitialPerTurn: 1, minFillerGapMs: 6000,
            maxTokens: 10, enableOnFirstReply: true
        )

        let json = try encodeToDictionary(SessionUpdateEvent(config: config))
        let session = try XCTUnwrap(json["session"] as? [String: Any])
        let providerData = try XCTUnwrap(session["providerData"] as? [String: Any])

        let backchannel = try XCTUnwrap(providerData["backchannel"] as? [String: Any])
        XCTAssertEqual(backchannel["enabled"] as? Bool, true)
        XCTAssertEqual(backchannel["max_per_turn"] as? Int, 2)
        XCTAssertEqual(backchannel["min_gap_ms"] as? Int, 3000)
        XCTAssertEqual(backchannel["min_speech_ms"] as? Int, 600)
        XCTAssertEqual(backchannel["volume_gain"] as? Double, 0.5)
        XCTAssertEqual(backchannel["decider_kind"] as? String, "rule")
        XCTAssertEqual(backchannel["rule_fire_probability"] as? Double, 0.25)

        let responsiveness = try XCTUnwrap(providerData["responsiveness"] as? [String: Any])
        XCTAssertEqual(responsiveness["enabled"] as? Bool, true)
        XCTAssertEqual(responsiveness["initial_wait_timeout_ms"] as? Int, 900)
        XCTAssertEqual(responsiveness["max_initial_per_turn"] as? Int, 1)
        XCTAssertEqual(responsiveness["min_filler_gap_ms"] as? Int, 6000)
        XCTAssertEqual(responsiveness["max_tokens"] as? Int, 10)
        XCTAssertEqual(responsiveness["enable_filler_on_first_assistant_reply"] as? Bool, true)
    }

    func testProviderDataOnlyBackchannel() throws {
        var config = makeBaseConfig()
        config.backchannel = SessionConfig.BackchannelConfig(
            maxPerTurn: 3, minGapMs: 4000, minSpeechMs: 800, volumeGain: 0.6,
            deciderKind: "llm", ruleFireProbability: 0.5
        )
        let json = try encodeToDictionary(SessionUpdateEvent(config: config))
        let providerData = try XCTUnwrap((json["session"] as? [String: Any])?["providerData"] as? [String: Any])
        let backchannel = try XCTUnwrap(providerData["backchannel"] as? [String: Any])
        // rule_fire_probability is omitted for the llm decider.
        XCTAssertNil(backchannel["rule_fire_probability"])
        XCTAssertNil(providerData["responsiveness"])
    }

    func testConversationItemCreateShape() throws {
        let json = try encodeToDictionary(ConversationItemCreateEvent(userText: "Say hello."))
        XCTAssertEqual(json["type"] as? String, "conversation.item.create")
        let item = try XCTUnwrap(json["item"] as? [String: Any])
        XCTAssertEqual(item["type"] as? String, "message")
        XCTAssertEqual(item["role"] as? String, "user")
        let content = try XCTUnwrap(item["content"] as? [[String: Any]])
        XCTAssertEqual(content.count, 1)
        XCTAssertEqual(content[0]["type"] as? String, "input_text")
        XCTAssertEqual(content[0]["text"] as? String, "Say hello.")
    }

    func testResponseCreateAndCancel() throws {
        XCTAssertEqual(try encodeToDictionary(ResponseCreateEvent())["type"] as? String, "response.create")
        XCTAssertEqual(try encodeToDictionary(ResponseCancelEvent())["type"] as? String, "response.cancel")
    }
}
