class BackchannelConfig {
  const BackchannelConfig({
    this.maxPerTurn = 3,
    this.minGapMs = 4000,
    this.minSpeechMs = 800,
    this.volumeGain = 0.6,
    this.deciderKind = 'llm',
    this.ruleFireProbability = 1.0,
  });

  final int maxPerTurn;
  final int minGapMs;
  final int minSpeechMs;
  final double volumeGain;
  final String deciderKind;
  final double ruleFireProbability;
}

class ResponsivenessConfig {
  const ResponsivenessConfig({
    this.initialWaitTimeoutMs = 1200,
    this.maxInitialPerTurn = 1,
    this.minFillerGapMs = 8000,
    this.maxTokens = 12,
    this.enableOnFirstReply = false,
  });

  final int initialWaitTimeoutMs;
  final int maxInitialPerTurn;
  final int minFillerGapMs;
  final int maxTokens;
  final bool enableOnFirstReply;
}

class WebSearchConfig {
  const WebSearchConfig({
    this.engine = 'google',
    this.maxResults = 3,
    this.maxSteps = 1,
  });

  final String engine;
  final int maxResults;
  final int maxSteps;
}

class SessionConfig {
  const SessionConfig({
    required this.model,
    required this.instructions,
    required this.ttsModel,
    required this.voice,
    required this.greetingPrompt,
    this.temperature,
    this.maxOutputTokens,
    this.speechSpeed,
    this.transcriptionModel,
    this.transcriptionLanguage,
    this.noiseReduction,
    this.eagerness = 'high',
    this.webSearch,
    this.createResponse = true,
    this.interruptResponse = true,
    this.backchannel,
    this.responsiveness,
  });

  final String model;
  final String instructions;
  final String ttsModel;
  final String voice;
  final String greetingPrompt;

  final double? temperature;
  final int? maxOutputTokens;
  final double? speechSpeed;

  final String? transcriptionModel;
  final String? transcriptionLanguage;
  final String? noiseReduction;

  /// This example uses semantic VAD only; the native examples also expose server VAD.
  final String eagerness;

  final WebSearchConfig? webSearch;
  final bool createResponse;
  final bool interruptResponse;

  final BackchannelConfig? backchannel;
  final ResponsivenessConfig? responsiveness;
}
