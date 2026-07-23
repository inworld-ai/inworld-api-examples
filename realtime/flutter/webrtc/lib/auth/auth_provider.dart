import 'dart:convert';

import 'package:http/http.dart' as http;

class IceServer {
  IceServer({required this.urls, this.username, this.credential});

  final List<String> urls;
  final String? username;
  final String? credential;

  /// `urls` may arrive as a single string or an array of strings.
  factory IceServer.fromJson(Map<String, dynamic> json) {
    final rawUrls = json['urls'];
    return IceServer(
      urls: rawUrls is String
          ? [rawUrls]
          : (rawUrls as List).map((e) => e as String).toList(),
      username: json['username'] as String?,
      credential: json['credential'] as String?,
    );
  }
}

class RealtimeCredentials {
  RealtimeCredentials({
    required this.authorizationHeader,
    this.apiBaseUrl = 'https://api.inworld.ai',
    this.callsUrl,
    this.preFetchedIceServers,
  });

  final String authorizationHeader;
  final String apiBaseUrl;
  final String? callsUrl;
  final List<IceServer>? preFetchedIceServers;
}

class AuthException implements Exception {
  AuthException(this.message);
  final String message;
  @override
  String toString() => message;
}

abstract class AuthProvider {
  Future<RealtimeCredentials> credentials();
}

class BasicAuthProvider implements AuthProvider {
  BasicAuthProvider(this.apiKey);
  final String apiKey;

  @override
  Future<RealtimeCredentials> credentials() async {
    final key = apiKey.trim();
    if (key.isEmpty) {
      throw AuthException('Inworld API key is not set. Add it in Settings.');
    }
    return RealtimeCredentials(authorizationHeader: 'Basic $key');
  }
}

/// Fetches a short-lived JWT from a trusted backend (the JS example's `webrtc/jwt`
/// Node server) so no Inworld key/secret ships in the app.
class BackendJwtAuthProvider implements AuthProvider {
  BackendJwtAuthProvider(this.backendUrl, {http.Client? client})
      : _client = client ?? http.Client();

  final String backendUrl;
  final http.Client _client;

  @override
  Future<RealtimeCredentials> credentials() async {
    final base = Uri.tryParse(backendUrl);
    if (base == null) throw AuthException('Backend URL is invalid.');

    final response = await _client.get(base.resolve('api/config'));
    if (response.statusCode != 200) {
      throw AuthException('Backend config request failed: HTTP ${response.statusCode}');
    }

    final Map<String, dynamic> config;
    try {
      config = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw AuthException('Backend returned an invalid config payload.');
    }

    final iceServers = (config['ice_servers'] as List?)
        ?.map((e) => IceServer.fromJson(e as Map<String, dynamic>))
        .toList();
    final callsUrl = (config['url'] as String?)?.isNotEmpty == true
        ? config['url'] as String
        : null;

    return RealtimeCredentials(
      authorizationHeader: 'Bearer ${config['jwt']}',
      callsUrl: callsUrl,
      preFetchedIceServers: iceServers,
    );
  }
}
