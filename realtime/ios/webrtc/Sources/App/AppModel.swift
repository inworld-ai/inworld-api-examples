import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
    let settings: SettingsStore
    let conversation: ConversationViewModel
    let catalog: CatalogStore

    init() {
        let settings = SettingsStore()
        self.settings = settings
        conversation = ConversationViewModel(settings: settings)
        catalog = CatalogStore(settings: settings)
    }
}
