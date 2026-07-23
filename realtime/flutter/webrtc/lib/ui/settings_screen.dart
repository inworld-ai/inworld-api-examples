import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../storage/settings.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final SettingsStore _settings = context.read<SettingsStore>();

  // Uncontrolled text controllers, seeded once — writing back into the field on
  // every keystroke via the store round-trip drops characters (a bug we hit on
  // the native apps), so the store is written on change but never read back here.
  late final _controllers = <String, TextEditingController>{
    'apiKey': TextEditingController(text: _settings.apiKey),
    'backendUrl': TextEditingController(text: _settings.backendUrl),
    'model': TextEditingController(text: _settings.model),
    'instructions': TextEditingController(text: _settings.instructions),
    'greeting': TextEditingController(text: _settings.greetingPrompt),
    'ttsModel': TextEditingController(text: _settings.ttsModel),
    'voice': TextEditingController(text: _settings.voice),
  };

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: AnimatedBuilder(
        animation: _settings,
        builder: (context, _) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _section('Authentication'),
            DropdownButtonFormField<AuthMode>(
              initialValue: _settings.authMode,
              decoration: const InputDecoration(labelText: 'Auth mode'),
              items: [
                for (final m in AuthMode.values)
                  DropdownMenuItem(value: m, child: Text(m.label)),
              ],
              onChanged: (m) => _settings.authMode = m!,
            ),
            if (_settings.authMode == AuthMode.basic)
              _field('apiKey', 'INWORLD API key (base64)',
                  (v) => _settings.apiKey = v, obscure: true)
            else
              _field('backendUrl', 'Backend URL',
                  (v) => _settings.backendUrl = v),
            _section('Model'),
            _field('model', 'LLM model', (v) => _settings.model = v),
            _field('instructions', 'Instructions',
                (v) => _settings.instructions = v, maxLines: 3),
            _field('greeting', 'Greeting prompt',
                (v) => _settings.greetingPrompt = v, maxLines: 2),
            SwitchListTile(
              title: const Text('Google web search'),
              value: _settings.webSearchEnabled,
              onChanged: (v) => _settings.webSearchEnabled = v,
            ),
            SwitchListTile(
              title: const Text('Custom temperature'),
              value: _settings.temperatureEnabled,
              onChanged: (v) => _settings.temperatureEnabled = v,
            ),
            if (_settings.temperatureEnabled)
              _slider('Temperature', _settings.temperature, 0, 2,
                  (v) => _settings.temperature = v),
            _section('Voice output'),
            _field('ttsModel', 'TTS model', (v) => _settings.ttsModel = v),
            _field('voice', 'Voice', (v) => _settings.voice = v),
            _slider('Speed', _settings.speechSpeed, 0.5, 1.5,
                (v) => _settings.speechSpeed = v),
            _section('Turn detection'),
            DropdownButtonFormField<String>(
              initialValue: _settings.eagerness,
              decoration: const InputDecoration(labelText: 'Eagerness'),
              items: [
                for (final e in eagernessOptions)
                  DropdownMenuItem(value: e, child: Text(e)),
              ],
              onChanged: (e) => _settings.eagerness = e!,
            ),
            SwitchListTile(
              title: const Text('Create response'),
              value: _settings.createResponse,
              onChanged: (v) => _settings.createResponse = v,
            ),
            SwitchListTile(
              title: const Text('Interrupt response (barge-in)'),
              value: _settings.interruptResponse,
              onChanged: (v) => _settings.interruptResponse = v,
            ),
            _section('Conversational features'),
            SwitchListTile(
              title: const Text('Back-channel ("uh-huh")'),
              value: _settings.backchannelEnabled,
              onChanged: (v) => _settings.backchannelEnabled = v,
            ),
            SwitchListTile(
              title: const Text('Responsiveness (low-latency filler)'),
              value: _settings.responsivenessEnabled,
              onChanged: (v) => _settings.responsivenessEnabled = v,
            ),
          ],
        ),
      ),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(top: 20, bottom: 8),
        child: Text(title, style: Theme.of(context).textTheme.titleMedium),
      );

  Widget _field(
    String key,
    String label,
    ValueChanged<String> onChanged, {
    bool obscure = false,
    int maxLines = 1,
  }) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: TextField(
          controller: _controllers[key],
          obscureText: obscure,
          maxLines: maxLines,
          decoration: InputDecoration(labelText: label),
          onChanged: onChanged,
        ),
      );

  Widget _slider(
    String label,
    double value,
    double min,
    double max,
    ValueChanged<double> onChanged,
  ) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$label: ${value.toStringAsFixed(2)}'),
            Slider(
              value: value.clamp(min, max),
              min: min,
              max: max,
              onChanged: onChanged,
            ),
          ],
        ),
      );
}
