import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:inworld_voice_agent/realtime/events/client_events.dart';
import 'package:inworld_voice_agent/realtime/session_config.dart';

SessionConfig baseConfig({
  WebSearchConfig? webSearch,
  BackchannelConfig? backchannel,
  ResponsivenessConfig? responsiveness,
  double? speechSpeed,
  double? temperature,
  int? maxOutputTokens,
  String? transcriptionModel,
  String? transcriptionLanguage,
  String? noiseReduction,
}) =>
    SessionConfig(
      model: 'openai/gpt-4o-mini',
      instructions: 'Be brief.',
      ttsModel: 'inworld-tts-2',
      voice: 'Clive',
      greetingPrompt: 'Say hello.',
      webSearch: webSearch,
      backchannel: backchannel,
      responsiveness: responsiveness,
      speechSpeed: speechSpeed,
      temperature: temperature,
      maxOutputTokens: maxOutputTokens,
      transcriptionModel: transcriptionModel,
      transcriptionLanguage: transcriptionLanguage,
      noiseReduction: noiseReduction,
    );

void main() {
  group('sessionUpdateEvent', () {
    test('default shape', () {
      final json = sessionUpdateEvent(baseConfig());
      expect(json['type'], 'session.update');

      final session = json['session'] as Map<String, dynamic>;
      expect(session['type'], 'realtime');
      expect(session['model'], 'openai/gpt-4o-mini');
      expect(session['instructions'], 'Be brief.');
      expect(session['output_modalities'], ['audio', 'text']);
      expect(session.containsKey('temperature'), isFalse);
      expect(session.containsKey('max_output_tokens'), isFalse);
      expect(session.containsKey('tools'), isFalse);
      expect(session.containsKey('providerData'), isFalse);

      final input = (session['audio'] as Map)['input'] as Map;
      expect(input.containsKey('transcription'), isFalse);
      expect(input.containsKey('noise_reduction'), isFalse);

      final td = input['turn_detection'] as Map;
      expect(td['type'], 'semantic_vad');
      expect(td['eagerness'], 'high');
      expect(td['create_response'], true);
      expect(td['interrupt_response'], true);

      final output = (session['audio'] as Map)['output'] as Map;
      expect(output['model'], 'inworld-tts-2');
      expect(output['voice'], 'Clive');
      expect(output.containsKey('speed'), isFalse);
    });

    test('web search encodes a tool with camelCase providerData', () {
      final config = baseConfig(webSearch: const WebSearchConfig());
      final raw = jsonEncode(sessionUpdateEvent(config));
      expect(raw.contains('"providerData"'), isTrue);
      expect(raw.contains('"provider_data"'), isFalse);

      final session = sessionUpdateEvent(config)['session'] as Map<String, dynamic>;
      final tools = session['tools'] as List;
      expect(tools.length, 1);
      final tool = tools.first as Map;
      expect(tool['type'], 'web_search');
      final pd = tool['providerData'] as Map;
      expect(pd['engine'], 'google');
      expect(pd['max_results'], 3);
      expect(pd['max_steps'], 1);
    });

    test('providerData key stays camelCase while inner keys are snake_case', () {
      final config = baseConfig(backchannel: const BackchannelConfig());
      final raw = jsonEncode(sessionUpdateEvent(config));
      expect(raw.contains('"providerData"'), isTrue);
      expect(raw.contains('"provider_data"'), isFalse);
      expect(raw.contains('"max_per_turn"'), isTrue);
      expect(raw.contains('"output_modalities"'), isTrue);
    });

    test('providerData omitted by default', () {
      final session = sessionUpdateEvent(baseConfig())['session'] as Map;
      expect(session.containsKey('providerData'), isFalse);
    });

    test('back-channel and responsiveness encoding', () {
      final config = baseConfig(
        backchannel: const BackchannelConfig(deciderKind: 'rule', ruleFireProbability: 0.25),
        responsiveness: const ResponsivenessConfig(enableOnFirstReply: true),
      );
      final session = sessionUpdateEvent(config)['session'] as Map;
      final pd = session['providerData'] as Map;

      final bc = pd['backchannel'] as Map;
      expect(bc['enabled'], true);
      expect(bc['max_per_turn'], 3);
      expect(bc['decider_kind'], 'rule');
      expect(bc['rule_fire_probability'], 0.25);

      final resp = pd['responsiveness'] as Map;
      expect(resp['enabled'], true);
      expect(resp['enable_filler_on_first_assistant_reply'], true);
    });

    test('rule_fire_probability omitted for llm decider', () {
      final config = baseConfig(backchannel: const BackchannelConfig());
      final session = sessionUpdateEvent(config)['session'] as Map;
      final bc = (session['providerData'] as Map)['backchannel'] as Map;
      expect(bc.containsKey('rule_fire_probability'), isFalse);
    });

    test('optional fields encode when set', () {
      final config = baseConfig(
        temperature: 0.9,
        maxOutputTokens: 1024,
        speechSpeed: 1.25,
        transcriptionModel: 'inworld/inworld-stt-1',
        transcriptionLanguage: 'en',
        noiseReduction: 'near_field',
      );
      final session = sessionUpdateEvent(config)['session'] as Map;
      expect(session['temperature'], 0.9);
      expect(session['max_output_tokens'], 1024);

      final input = (session['audio'] as Map)['input'] as Map;
      final transcription = input['transcription'] as Map;
      expect(transcription['model'], 'inworld/inworld-stt-1');
      expect(transcription['language'], 'en');
      expect((input['noise_reduction'] as Map)['type'], 'near_field');
      expect(((session['audio'] as Map)['output'] as Map)['speed'], 1.25);
    });
  });

  test('conversationItemCreateEvent shape', () {
    final json = conversationItemCreateEvent('Say hello.');
    expect(json['type'], 'conversation.item.create');
    final item = json['item'] as Map;
    expect(item['type'], 'message');
    expect(item['role'], 'user');
    final content = item['content'] as List;
    expect(content.length, 1);
    expect((content.first as Map)['type'], 'input_text');
    expect((content.first as Map)['text'], 'Say hello.');
  });

  test('response.create and response.cancel', () {
    expect(responseCreateEvent()['type'], 'response.create');
    expect(responseCancelEvent()['type'], 'response.cancel');
  });
}
