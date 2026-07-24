import 'dart:convert';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';

/// Plays back-channel interjections, which arrive as base64 PCM16 chunks on the
/// data channel (separate from the WebRTC remote track) so they stay audible while
/// the user speaks.
///
/// The native examples stream each chunk into a live audio node. Flutter has no
/// stock streaming-PCM sink, so we take the portable route: buffer the chunks for
/// one interjection, then on `.done` wrap them in a WAV container and play the clip.
/// Back-channels are short ("uh-huh"), so the buffer-then-play latency is negligible.
class BackchannelPlayer {
  static const int _sampleRate = 24000; // realtime output default: 24 kHz mono PCM16

  final AudioPlayer _player = AudioPlayer(playerId: 'backchannel');
  final BytesBuilder _buffer = BytesBuilder(copy: false);

  void enqueue(String base64Pcm16) {
    if (base64Pcm16.isEmpty) return;
    _buffer.add(base64Decode(base64Pcm16));
  }

  Future<void> flush() async {
    if (_buffer.isEmpty) return;
    final pcm = _buffer.takeBytes();
    await _player.play(BytesSource(_wrapWav(pcm), mimeType: 'audio/wav'));
  }

  Future<void> stop() async {
    _buffer.clear();
    await _player.stop();
  }

  Future<void> dispose() async {
    await _player.dispose();
  }

  static Uint8List _wrapWav(Uint8List pcm) {
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = _sampleRate * channels * bitsPerSample ~/ 8;
    const blockAlign = channels * bitsPerSample ~/ 8;

    final header = BytesBuilder();
    void writeStr(String s) => header.add(ascii.encode(s));
    void writeU32(int v) => header.add(
          Uint8List(4)..buffer.asByteData().setUint32(0, v, Endian.little),
        );
    void writeU16(int v) => header.add(
          Uint8List(2)..buffer.asByteData().setUint16(0, v, Endian.little),
        );

    writeStr('RIFF');
    writeU32(36 + pcm.length);
    writeStr('WAVE');
    writeStr('fmt ');
    writeU32(16);
    writeU16(1); // PCM
    writeU16(channels);
    writeU32(_sampleRate);
    writeU32(byteRate);
    writeU16(blockAlign);
    writeU16(bitsPerSample);
    writeStr('data');
    writeU32(pcm.length);
    header.add(pcm);
    return header.toBytes();
  }
}
