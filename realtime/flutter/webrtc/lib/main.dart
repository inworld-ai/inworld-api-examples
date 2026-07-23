import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'state/conversation_controller.dart';
import 'storage/settings.dart';
import 'ui/conversation_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final settings = await SettingsStore.load();
  runApp(InworldVoiceAgentApp(settings: settings));
}

class InworldVoiceAgentApp extends StatelessWidget {
  const InworldVoiceAgentApp({super.key, required this.settings});

  final SettingsStore settings;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: settings),
        ChangeNotifierProvider(create: (_) => ConversationController(settings)),
      ],
      child: MaterialApp(
        title: 'Inworld Voice Agent',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF6C5CE7)),
          useMaterial3: true,
        ),
        darkTheme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF6C5CE7),
            brightness: Brightness.dark,
          ),
          useMaterial3: true,
        ),
        home: const ConversationScreen(),
      ),
    );
  }
}
