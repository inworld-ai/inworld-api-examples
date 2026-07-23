import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/conversation_controller.dart';
import 'message_bubble.dart';
import 'settings_screen.dart';

class ConversationScreen extends StatelessWidget {
  const ConversationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<ConversationController>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inworld Voice Agent'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: controller.isConnected || controller.isBusy
                ? null
                : () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const SettingsScreen()),
                    ),
          ),
        ],
      ),
      body: Column(
        children: [
          if (controller.errorMessage != null)
            _Banner(message: controller.errorMessage!),
          Expanded(
            child: controller.transcript.isEmpty
                ? const _EmptyState()
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: controller.transcript.length,
                    itemBuilder: (_, i) =>
                        MessageBubble(item: controller.transcript[i]),
                  ),
          ),
          _Controls(controller: controller),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(
          'Tap Connect and start talking.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      color: scheme.errorContainer,
      padding: const EdgeInsets.all(12),
      child: Text(message, style: TextStyle(color: scheme.onErrorContainer)),
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls({required this.controller});
  final ConversationController controller;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            if (controller.isConnected)
              IconButton.filledTonal(
                icon: Icon(controller.isMicMuted ? Icons.mic_off : Icons.mic),
                onPressed: () => controller.setMicMuted(!controller.isMicMuted),
              ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton.icon(
                icon: controller.isBusy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(controller.isConnected ? Icons.call_end : Icons.call),
                label: Text(
                  controller.isBusy
                      ? 'Connecting…'
                      : controller.isConnected
                          ? 'Disconnect'
                          : 'Connect',
                ),
                style: controller.isConnected
                    ? FilledButton.styleFrom(
                        backgroundColor: Theme.of(context).colorScheme.error,
                      )
                    : null,
                onPressed: controller.isBusy
                    ? null
                    : () => controller.isConnected
                        ? controller.disconnect()
                        : controller.connect(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
