enum TranscriptRole { user, agent }

class TranscriptItem {
  TranscriptItem({
    required this.id,
    required this.role,
    required this.text,
    this.isStreaming = false,
  });

  final int id;
  final TranscriptRole role;
  String text;
  bool isStreaming;
}
