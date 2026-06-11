import Foundation
import Observation

@MainActor
@Observable
final class CatalogStore {
    private(set) var models: [LLMModelInfo] = []
    private(set) var voices: [VoiceInfo] = []
    private(set) var isLoadingModels = false
    private(set) var isLoadingVoices = false
    private(set) var modelsError: String?
    private(set) var voicesError: String?

    private let settings: SettingsStore

    init(settings: SettingsStore) {
        self.settings = settings
    }

    func loadModels(force: Bool = false) async {
        guard force || (models.isEmpty && !isLoadingModels) else { return }
        isLoadingModels = true
        modelsError = nil
        defer { isLoadingModels = false }
        do {
            let credentials = try await settings.makeAuthProvider().credentials()
            models = try await CatalogAPI(credentials: credentials).fetchModels()
        } catch {
            modelsError = error.localizedDescription
        }
    }

    func loadVoices(force: Bool = false) async {
        guard force || (voices.isEmpty && !isLoadingVoices) else { return }
        isLoadingVoices = true
        voicesError = nil
        defer { isLoadingVoices = false }
        do {
            let credentials = try await settings.makeAuthProvider().credentials()
            voices = try await CatalogAPI(credentials: credentials).fetchVoices()
        } catch {
            voicesError = error.localizedDescription
        }
    }
}
