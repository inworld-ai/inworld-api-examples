import '../session_config.dart';

/// Client → server events, serialized to the realtime session schema.
///
/// The schema is snake_case everywhere EXCEPT the single key `providerData`, which
/// the Go server unmarshals as camelCase (`json:"providerData"`). A blanket
/// snake_case strategy would emit `provider_data`, which the server silently ignores
/// — so back-channel, responsiveness, and web search never turn on. We build the JSON
/// maps by hand so that one key stays camelCase while its inner keys are snake_case.
///
/// Null-valued fields are omitted (via the `putIfNotNull` helper) to match the
/// native examples' `explicitNulls = false` behavior.
extension _OmitNull on Map<String, dynamic> {
  void putIfNotNull(String key, Object? value) {
    if (value != null) this[key] = value;
  }
}

Map<String, dynamic> sessionUpdateEvent(SessionConfig config) {
  final turnDetection = <String, dynamic>{
    'type': 'semantic_vad',
    'eagerness': config.eagerness,
    'create_response': config.createResponse,
    'interrupt_response': config.interruptResponse,
  };

  final input = <String, dynamic>{'turn_detection': turnDetection};
  if (config.transcriptionModel != null || config.transcriptionLanguage != null) {
    input['transcription'] = <String, dynamic>{}
      ..putIfNotNull('model', config.transcriptionModel)
      ..putIfNotNull('language', config.transcriptionLanguage);
  }
  if (config.noiseReduction != null) {
    input['noise_reduction'] = {'type': config.noiseReduction};
  }

  final output = <String, dynamic>{
    'model': config.ttsModel,
    'voice': config.voice,
  }..putIfNotNull('speed', config.speechSpeed);

  final session = <String, dynamic>{
    'type': 'realtime',
    'model': config.model,
    'instructions': config.instructions,
    'output_modalities': ['audio', 'text'],
    'audio': {'input': input, 'output': output},
  }
    ..putIfNotNull('temperature', config.temperature)
    ..putIfNotNull('max_output_tokens', config.maxOutputTokens);

  final webSearch = config.webSearch;
  if (webSearch != null) {
    session['tools'] = [
      {
        'type': 'web_search',
        // Literal camelCase key — see the class doc above.
        'providerData': <String, dynamic>{'engine': webSearch.engine}
          ..putIfNotNull('max_results', webSearch.maxResults)
          ..putIfNotNull('max_steps', webSearch.maxSteps),
      },
    ];
  }

  final providerData = _providerData(config);
  if (providerData != null) session['providerData'] = providerData;

  return {'type': 'session.update', 'session': session};
}

Map<String, dynamic>? _providerData(SessionConfig config) {
  final bc = config.backchannel;
  final resp = config.responsiveness;
  if (bc == null && resp == null) return null;

  final providerData = <String, dynamic>{};
  if (bc != null) {
    providerData['backchannel'] = <String, dynamic>{
      'enabled': true,
      'max_per_turn': bc.maxPerTurn,
      'min_gap_ms': bc.minGapMs,
      'min_speech_ms': bc.minSpeechMs,
      'volume_gain': bc.volumeGain,
      'decider_kind': bc.deciderKind,
    }..putIfNotNull(
        'rule_fire_probability',
        bc.deciderKind == 'rule' ? bc.ruleFireProbability : null,
      );
  }
  if (resp != null) {
    providerData['responsiveness'] = {
      'enabled': true,
      'initial_wait_timeout_ms': resp.initialWaitTimeoutMs,
      'max_initial_per_turn': resp.maxInitialPerTurn,
      'min_filler_gap_ms': resp.minFillerGapMs,
      'max_tokens': resp.maxTokens,
      'enable_filler_on_first_assistant_reply': resp.enableOnFirstReply,
    };
  }
  return providerData;
}

Map<String, dynamic> conversationItemCreateEvent(String userText) => {
      'type': 'conversation.item.create',
      'item': {
        'type': 'message',
        'role': 'user',
        'content': [
          {'type': 'input_text', 'text': userText},
        ],
      },
    };

Map<String, dynamic> responseCreateEvent() => {'type': 'response.create'};

Map<String, dynamic> responseCancelEvent() => {'type': 'response.cancel'};
