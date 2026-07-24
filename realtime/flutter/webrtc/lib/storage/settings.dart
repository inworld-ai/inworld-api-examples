import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../auth/auth_provider.dart';
import '../realtime/session_config.dart';
import '../secrets.dart';

enum AuthMode {
  basic('API Key (Basic)'),
  backendJwt('Backend JWT');

  const AuthMode(this.label);
  final String label;
}

enum NoiseReductionMode {
  off(null, 'Server default'),
  nearField('near_field', 'Near field'),
  farField('far_field', 'Far field');

  const NoiseReductionMode(this.wire, this.label);
  final String? wire;
  final String label;
}

const eagernessOptions = ['low', 'medium', 'high', 'auto'];

/// Persists settings in SharedPreferences — the Flutter analog of the Android
/// example's DataStore. Like that example, the API key is stored in plain prefs
/// for demo simplicity; a production app should use flutter_secure_storage.
class SettingsStore extends ChangeNotifier {
  SettingsStore._(this._prefs);

  final SharedPreferences _prefs;

  static Future<SettingsStore> load() async {
    return SettingsStore._(await SharedPreferences.getInstance());
  }

  T _get<T>(String key, T fallback) => (_prefs.get(key) as T?) ?? fallback;

  Future<void> _set(String key, Object value) async {
    switch (value) {
      case String v:
        await _prefs.setString(key, v);
      case int v:
        await _prefs.setInt(key, v);
      case double v:
        await _prefs.setDouble(key, v);
      case bool v:
        await _prefs.setBool(key, v);
    }
    notifyListeners();
  }

  // Auth
  String get apiKey => _get('apiKey', inworldApiKey);
  set apiKey(String v) => _set('apiKey', v);
  AuthMode get authMode =>
      AuthMode.values.byNameOrNull(_get('authMode', '')) ?? AuthMode.basic;
  set authMode(AuthMode v) => _set('authMode', v.name);
  String get backendUrl => _get('backendUrl', 'http://localhost:3000');
  set backendUrl(String v) => _set('backendUrl', v);

  // Model
  String get model => _get('model', 'inworld/models/gemma-4-26b-a4b-it');
  set model(String v) => _set('model', v);
  String get instructions =>
      _get('instructions', 'You are a friendly voice assistant. Keep responses brief.');
  set instructions(String v) => _set('instructions', v);
  String get greetingPrompt =>
      _get('greetingPrompt', 'Say hello and ask how you can help. One sentence max.');
  set greetingPrompt(String v) => _set('greetingPrompt', v);
  bool get temperatureEnabled => _get('temperatureEnabled', false);
  set temperatureEnabled(bool v) => _set('temperatureEnabled', v);
  double get temperature => _get('temperature', 0.7);
  set temperature(double v) => _set('temperature', v);

  /// 0 means "server default" (not sent).
  int get maxOutputTokens => _get('maxOutputTokens', 0);
  set maxOutputTokens(int v) => _set('maxOutputTokens', v);
  bool get webSearchEnabled => _get('webSearchEnabled', true);
  set webSearchEnabled(bool v) => _set('webSearchEnabled', v);

  // Voice output
  String get ttsModel => _get('ttsModel', 'inworld-tts-2');
  set ttsModel(String v) => _set('ttsModel', v);
  String get voice => _get('voice', 'Clive');
  set voice(String v) => _set('voice', v);
  double get speechSpeed {
    final v = _get('speechSpeed', 1.0);
    return (v >= 0.5 && v <= 1.5) ? v : 1.0;
  }

  set speechSpeed(double v) => _set('speechSpeed', v.clamp(0.5, 1.5));

  // Audio input
  String get transcriptionModel => _get('transcriptionModel', '');
  set transcriptionModel(String v) => _set('transcriptionModel', v);
  String get transcriptionLanguage => _get('transcriptionLanguage', '');
  set transcriptionLanguage(String v) => _set('transcriptionLanguage', v);
  NoiseReductionMode get noiseReduction =>
      NoiseReductionMode.values.byNameOrNull(_get('noiseReduction', '')) ??
      NoiseReductionMode.off;
  set noiseReduction(NoiseReductionMode v) => _set('noiseReduction', v.name);

  // Turn detection (semantic VAD)
  String get eagerness => _get('eagerness', 'high');
  set eagerness(String v) => _set('eagerness', v);
  bool get createResponse => _get('createResponse', true);
  set createResponse(bool v) => _set('createResponse', v);
  bool get interruptResponse => _get('interruptResponse', true);
  set interruptResponse(bool v) => _set('interruptResponse', v);

  // Back-channel
  bool get backchannelEnabled => _get('backchannelEnabled', true);
  set backchannelEnabled(bool v) => _set('backchannelEnabled', v);

  // Responsiveness
  bool get responsivenessEnabled => _get('responsivenessEnabled', true);
  set responsivenessEnabled(bool v) => _set('responsivenessEnabled', v);

  AuthProvider makeAuthProvider() => switch (authMode) {
        AuthMode.basic => BasicAuthProvider(apiKey),
        AuthMode.backendJwt => BackendJwtAuthProvider(backendUrl),
      };

  SessionConfig makeSessionConfig() => SessionConfig(
        model: model,
        instructions: instructions,
        temperature: temperatureEnabled ? temperature : null,
        maxOutputTokens: maxOutputTokens > 0 ? maxOutputTokens : null,
        ttsModel: ttsModel,
        voice: voice,
        speechSpeed: speechSpeed == 1.0 ? null : speechSpeed,
        transcriptionModel: transcriptionModel.isEmpty ? null : transcriptionModel,
        transcriptionLanguage:
            transcriptionLanguage.isEmpty ? null : transcriptionLanguage,
        noiseReduction: noiseReduction.wire,
        eagerness: eagerness,
        webSearch: webSearchEnabled ? const WebSearchConfig() : null,
        createResponse: createResponse,
        interruptResponse: interruptResponse,
        backchannel: backchannelEnabled ? const BackchannelConfig() : null,
        responsiveness:
            responsivenessEnabled ? const ResponsivenessConfig() : null,
        greetingPrompt: greetingPrompt,
      );
}

extension<T extends Enum> on List<T> {
  T? byNameOrNull(String name) {
    for (final value in this) {
      if (value.name == name) return value;
    }
    return null;
  }
}
