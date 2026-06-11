import SwiftUI

struct ModelPickerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: String

    private var supportedModels: [LLMModelInfo] {
        model.catalog.models.filter { $0.isSupported != false }
    }

    var body: some View {
        NavigationStack {
            Group {
                if model.catalog.isLoadingModels && model.catalog.models.isEmpty {
                    ProgressView("Loading models…")
                } else if let error = model.catalog.modelsError, model.catalog.models.isEmpty {
                    CatalogErrorView(message: error) {
                        Task { await model.catalog.loadModels(force: true) }
                    }
                } else {
                    List(supportedModels) { item in
                        Button {
                            selection = item.realtimeIdentifier
                            dismiss()
                        } label: {
                            row(for: item)
                        }
                        .tint(.primary)
                    }
                }
            }
            .navigationTitle("Models")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.catalog.loadModels(force: true) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
        .task { await model.catalog.loadModels() }
    }

    private func row(for item: LLMModelInfo) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.realtimeIdentifier)
                Text(subtitle(for: item)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if item.realtimeIdentifier == selection {
                Image(systemName: "checkmark").foregroundStyle(.tint)
            }
        }
    }

    private func subtitle(for item: LLMModelInfo) -> String {
        var parts: [String] = []
        if let provider = item.provider, !provider.isEmpty {
            parts.append("Provider: \(provider)")
        }
        if let creator = item.modelCreator, !creator.isEmpty {
            parts.append(creator)
        }
        return parts.joined(separator: " · ")
    }
}

struct VoicePickerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: String
    @State private var query = ""

    private var filteredVoices: [VoiceInfo] {
        let voices = model.catalog.voices
        guard !query.isEmpty else { return voices }
        let q = query.lowercased()
        return voices.filter {
            ($0.displayName ?? $0.voiceId).lowercased().contains(q)
                || $0.voiceId.lowercased().contains(q)
                || ($0.langCode ?? "").lowercased().contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if model.catalog.isLoadingVoices && model.catalog.voices.isEmpty {
                    ProgressView("Loading voices…")
                } else if let error = model.catalog.voicesError, model.catalog.voices.isEmpty {
                    CatalogErrorView(message: error) {
                        Task { await model.catalog.loadVoices(force: true) }
                    }
                } else {
                    List(filteredVoices) { voice in
                        Button {
                            selection = voice.voiceId
                            dismiss()
                        } label: {
                            row(for: voice)
                        }
                        .tint(.primary)
                    }
                    .searchable(text: $query, prompt: "Search voices")
                }
            }
            .navigationTitle("Voices")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.catalog.loadVoices(force: true) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
        .task { await model.catalog.loadVoices() }
    }

    private func row(for voice: VoiceInfo) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(voice.displayName ?? voice.voiceId)
                Text(voiceSubtitle(voice))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if voice.voiceId == selection {
                Image(systemName: "checkmark").foregroundStyle(.tint)
            }
        }
    }

    private func voiceSubtitle(_ voice: VoiceInfo) -> String {
        [voice.langCode, voice.gender, voice.source]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: " · ")
    }
}

private struct CatalogErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(message)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Retry", action: retry)
                .buttonStyle(.bordered)
        }
        .padding()
    }
}
