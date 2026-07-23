import 'package:flutter/material.dart';

import '../state/transcript_item.dart';

class MessageBubble extends StatelessWidget {
  const MessageBubble({super.key, required this.item});

  final TranscriptItem item;

  @override
  Widget build(BuildContext context) {
    final isUser = item.role == TranscriptRole.user;
    final scheme = Theme.of(context).colorScheme;
    final bg = isUser ? scheme.primaryContainer : scheme.surfaceContainerHighest;
    final fg = isUser ? scheme.onPrimaryContainer : scheme.onSurface;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.78,
        ),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          item.text.isEmpty && item.isStreaming ? '…' : item.text,
          style: TextStyle(
            color: fg,
            fontStyle: item.isStreaming ? FontStyle.italic : FontStyle.normal,
          ),
        ),
      ),
    );
  }
}
