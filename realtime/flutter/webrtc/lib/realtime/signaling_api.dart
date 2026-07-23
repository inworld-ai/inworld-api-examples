import 'dart:convert';

import 'package:http/http.dart' as http;

import '../auth/auth_provider.dart';

class SignalingException implements Exception {
  SignalingException(this.message);
  final String message;
  @override
  String toString() => message;
}

class SignalingApi {
  SignalingApi(this.credentials, {http.Client? client})
      : _client = client ?? http.Client();

  final RealtimeCredentials credentials;
  final http.Client _client;

  Future<List<IceServer>> fetchIceServers() async {
    final preFetched = credentials.preFetchedIceServers;
    if (preFetched != null) return preFetched;

    final url = Uri.parse('${credentials.apiBaseUrl}/v1/realtime/ice-servers');
    final response = await _client.get(
      url,
      headers: {'Authorization': credentials.authorizationHeader},
    );
    _ensureOk(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return (json['ice_servers'] as List)
        .map((e) => IceServer.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<String> postOffer(String sdp) async {
    final url = Uri.parse(
      credentials.callsUrl ?? '${credentials.apiBaseUrl}/v1/realtime/calls',
    );
    final response = await _client.post(
      url,
      headers: {
        'Authorization': credentials.authorizationHeader,
        'Content-Type': 'application/sdp',
      },
      body: sdp,
    );
    _ensureOk(response);
    if (response.body.isEmpty) {
      throw SignalingException('Malformed response from Inworld API.');
    }
    return response.body;
  }

  void _ensureOk(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = response.body;
      throw SignalingException(
        'Inworld API error (HTTP ${response.statusCode}): '
        '${body.substring(0, body.length < 200 ? body.length : 200)}',
      );
    }
  }
}
