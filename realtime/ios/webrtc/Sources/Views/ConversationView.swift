import SwiftUI

struct ConversationView: View {
    @Environment(AppModel.self) private var model
    @State private var showsSettings = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                transcriptList
                Divider()
                ConnectionControlsView()
            }
            .navigationTitle("Inworld Voice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showsSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showsSettings) {
                SettingsView()
            }
        }
    }

    private var transcriptList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if model.conversation.transcript.isEmpty {
                        emptyState
                    }
                    ForEach(model.conversation.transcript) { item in
                        MessageBubbleView(item: item)
                            .id(item.id)
                    }
                }
                .padding()
            }
            .onChange(of: model.conversation.transcript) {
                // No withAnimation: transcript mutates on every streaming delta, and
                // animating each scroll causes jank during token-by-token output.
                if let last = model.conversation.transcript.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "waveform.circle")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text(model.conversation.isConnected
                 ? "Listening — just start talking."
                 : "Connect to start a voice conversation.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 80)
    }
}
