# Windsurf Architecture & RPC Analysis

A comprehensive analysis of Windsurf's internal architecture, communication protocols, and how Cascade chat sessions work under the hood — derived from reverse-engineering the installed application at `/usr/share/windsurf/resources/app/`.

---

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Component Breakdown](#component-breakdown)
3. [Communication Protocol: ConnectRPC + Protobuf](#communication-protocol-connectrpc--protobuf)
4. [Protobuf Services & RPC Methods](#protobuf-services--rpc-methods)
5. [Cascade Chat Session Lifecycle](#cascade-chat-session-lifecycle)
6. [API Server Endpoints & Routing](#api-server-endpoints--routing)
7. [Authentication & Security](#authentication--security)
8. [Feature Flags & Experimentation](#feature-flags--experimentation)
9. [Key Dependencies & Tech Stack](#key-dependencies--tech-stack)
10. [Interesting Discoveries](#interesting-discoveries)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Windsurf IDE (Electron)                        │
│                                                                         │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────────────────┐  │
│  │  VS Code UI  │   │ Windsurf Extension│   │  Other Extensions     │  │
│  │  (Workbench) │   │ (dist/extension.js│   │  (git, typescript...) │  │
│  └──────┬───────┘   └────────┬─────────┘   └────────────────────────┘  │
│         │                    │                                          │
│         │         ConnectRPC (HTTP/1.1, binary protobuf)               │
│         │          + CSRF token header                                  │
│         │                    │                                          │
│         │           ┌────────▼──────────┐                              │
│         │           │  Language Server   │                              │
│         │           │  (native binary)   │                              │
│         │           │                    │                              │
│         │           │  Ports exposed:    │                              │
│         │           │  - languageServer  │                              │
│         │           │  - lspPort         │                              │
│         │           │  - chatClientPort  │                              │
│         │           └────────┬──────────┘                              │
│         │                    │                                          │
└─────────┼────────────────────┼──────────────────────────────────────────┘
          │                    │
          │         gRPC / ConnectRPC (HTTP/2, binary protobuf)
          │                    │
          │     ┌──────────────▼───────────────────┐
          │     │       Codeium Cloud Services      │
          │     │                                    │
          │     │  server.codeium.com     (main API) │
          │     │  inference.codeium.com  (models)   │
          │     │  register.windsurf.com  (auth)     │
          │     │  unleash.codeium.com    (flags)    │
          │     └────────────────────────────────────┘
          │
          │  Standard VS Code Extension Host API
          ▼
   ┌──────────────┐
   │  File System  │
   │  Terminals    │
   │  Git, LSP...  │
   └──────────────┘
```

### Three-Tier Design

1. **Windsurf Extension** (TypeScript/JavaScript) — The UI layer. Handles the chat panel, code diffs, user interactions. Communicates with the language server via ConnectRPC.
2. **Language Server Binary** (native, compiled) — The intelligence layer. Runs locally, manages Cascade sessions, communicates with Codeium cloud. Acts as a **local proxy** between the extension and cloud services.
3. **Codeium Cloud** — The inference layer. Hosts the LLMs, manages user accounts, stores trajectories, handles billing.

---

## Component Breakdown

### Windsurf Extension (`extensions/windsurf/`)

| File | Size | Purpose |
|------|------|---------|
| `dist/extension.js` | ~9 MB | Compiled, minified extension code |
| `bin/language_server_linux_x64` | Native binary | Local language server |
| `bin/fd` | Native binary | Fast file discovery (used for context gathering) |
| `schemas/mcp_config.schema.json` | JSON | MCP configuration schema |
| `package.json` | JSON | Extension manifest |

### User Data (`~/.codeium/windsurf/`)

| Path | Format | Purpose |
|------|--------|---------|
| `installation_id` | Plain text (UUID) | Unique installation identifier |
| `user_settings.pb` | **Protobuf binary** | User settings (not JSON!) |
| `mcp_config.json` | JSON | MCP server configuration |
| `brain/` | Directory | Brain/knowledge base data |
| `cascade/` | Directory | Cascade session data |
| `memories/` | Directory | Cascade memories |
| `codemaps/` | Directory | Code map data |
| `context_state/` | Directory | Context state tracking |
| `database/` | Directory | Local database |

### IDE Config (`~/.config/Windsurf/`)

Standard Electron/Chromium data directory: cookies, cache, local storage, GPU cache, service workers, etc. No Cascade-specific logic here.

---

## Communication Protocol: ConnectRPC + Protobuf

### Why Not REST?

Windsurf does **not** use REST/JSON APIs for Cascade. Instead it uses:

- **ConnectRPC** — A modern RPC framework compatible with gRPC, but also works over HTTP/1.1 and HTTP/2 with standard HTTP semantics
- **Protocol Buffers (binary format)** — Compact, typed, schema-driven serialization
- **Server-streaming RPCs** — For real-time Cascade response streaming

### Transport Instances

The extension creates **three distinct ConnectRPC transports:**

#### 1. Local Language Server Transport

```
Protocol:    HTTP/1.1
Base URL:    http://localhost:{dynamic_port}
Format:      Binary Protobuf
Auth:        x-codeium-csrf-token header
Services:    LanguageServerService, ExtensionServerService
```

This is the primary transport. All Cascade operations go through here. The language server binary then proxies to the cloud.

#### 2. Registration Transport

```
Protocol:    HTTP/1.1
Base URL:    https://register.windsurf.com
Format:      Binary Protobuf
Auth:        Firebase ID token
Services:    SeatManagementService
```

Used only for initial user registration. Sends Firebase auth tokens directly to the registration server.

#### 3. Analytics Transport

```
Protocol:    HTTP/2
Base URL:    https://server.codeium.com
Format:      Binary Protobuf
Auth:        API key in metadata
Services:    ProductAnalyticsService
```

Telemetry and analytics go directly to the cloud, bypassing the language server.

### CSRF Protection

Every request to the local language server includes a CSRF token:

```javascript
// Interceptor added to all local requests
request.header.set("x-codeium-csrf-token", this.csrfToken)
```

The CSRF token is provided by the `ExtensionServerService` when the language server starts up.

---

## Protobuf Services & RPC Methods

### Service 1: `exa.language_server_pb.LanguageServerService`

The **core service** handling all Cascade and code intelligence operations. Communicates with the local language server binary.

#### Cascade Session Management

| Method | Type | Purpose |
|--------|------|---------|
| `StartCascade` | Unary | Create a new Cascade session, returns `cascadeId` |
| `SendUserCascadeMessage` | Unary | Send user text/context to Cascade |
| `QueueCascadeMessage` | Unary | Queue a message for later processing |
| `MoveQueuedMessage` | Unary | Reorder queued messages |
| `InterruptWithQueuedMessage` | Unary | Interrupt current processing with queued message |
| `RemoveFromQueue` | Unary | Remove a queued message |
| `BranchCascade` | Unary | Branch a conversation |
| `SpawnArenaModeMidConversation` | Unary | Start arena mode (model comparison) mid-conversation |
| `ConvergeArenaCascades` | Unary | Merge arena mode results |

#### Cascade Streaming (Server-Streaming RPCs)

| Method | Type | Purpose |
|--------|------|---------|
| `StreamCascadeReactiveUpdates` | Server-Streaming | Real-time Cascade response streaming |
| `StreamCascadePanelReactiveUpdates` | Server-Streaming | UI panel state updates |
| `StreamCascadeSummariesReactiveUpdates` | Server-Streaming | Conversation summary updates |
| `StreamUserTrajectoryReactiveUpdates` | Server-Streaming | User activity tracking |

#### Cascade Code Operations

| Method | Type | Purpose |
|--------|------|---------|
| `WriteCascadeEdit` | Unary | Apply a code edit from Cascade |
| `AcknowledgeCascadeCodeEdit` | Unary | Confirm a code edit was applied |
| `RevertToCascadeStep` | Unary | Revert code to a previous Cascade step |
| `GetRevertPreview` | Unary | Preview what reverting would change |
| `GetPatchAndCodeChange` | Unary | Get diff/patch for a code change |
| `GetWorkspaceEditState` | Unary | Get current workspace edit state |
| `ResolveWorktreeChanges` | Unary | Resolve git worktree changes |
| `ResolveOutstandingSteps` | Unary | Resolve pending Cascade steps |

#### Cascade History & Memory

| Method | Type | Purpose |
|--------|------|---------|
| `GetCascadeTrajectory` | Unary | Get full conversation trajectory |
| `GetCascadeTrajectorySteps` | Unary | Get individual steps |
| `GetAllCascadeTrajectories` | Unary | List all trajectories |
| `GetCascadeTrajectoryGeneratorMetadata` | Unary | Get generator metadata |
| `RenameCascadeTrajectory` | Unary | Rename a conversation |
| `UpdateCascadeTrajectorySummaries` | Unary | Update summaries |
| `GetCascadeMemories` | Unary | Retrieve Cascade memories |
| `UpdateCascadeMemory` | Unary | Create/update a memory |
| `DeleteCascadeMemory` | Unary | Delete a memory |
| `GetUserMemories` | Unary | Get user-level memories |

#### Code Intelligence

| Method | Type | Purpose |
|--------|------|---------|
| `GetCompletions` | Unary | Autocomplete suggestions |
| `GetLSPCompletionItems` | Unary | LSP completion items |
| `GetMatchingCodeContext` | Unary | Find relevant code context |
| `GetMatchingContextScopeItems` | Unary | Find matching scope items |
| `GetSuggestedContextScopeItems` | Unary | AI-suggested context |
| `GetCodeMapsForFile` | Unary | Get code maps for a file |
| `GetCodeMapsForRepos` | Unary | Get code maps for repositories |
| `GetCodeMapSuggestions` | Unary | Suggest code maps |
| `GetLintErrors` | Unary | Get lint errors |
| `GetCodeValidationStates` | Unary | Validate code changes |

#### Model & Configuration

| Method | Type | Purpose |
|--------|------|---------|
| `GetCascadeModelConfigs` | Unary | Available Cascade models |
| `GetCommandModelConfigs` | Unary | Command model configs |
| `GetModelStatuses` | Unary | Model availability status |
| `GetExternalModel` | Unary | External model configuration |
| `GetSetUserApiProviderKeys` | Unary | User API provider keys (BYOK) |
| `SetUserApiProviderKey` | Unary | Set a provider key |
| `GetLifeguardConfig` | Unary | Safety/guardrail configuration |

#### MCP (Model Context Protocol)

| Method | Type | Purpose |
|--------|------|---------|
| `GetMcpServerStates` | Unary | Get MCP server states |
| `RefreshMcpServers` | Unary | Refresh MCP connections |
| `SaveMcpServerToConfigFile` | Unary | Save MCP config |
| `UpdateMcpServerInConfigFile` | Unary | Update MCP config |
| `NotifyMcpStateChanged` | Unary | Notify state change |
| `ToggleMcpTool` | Unary | Enable/disable MCP tool |
| `GetMcpPrompt` | Unary | Get MCP prompt |

#### Miscellaneous

| Method | Type | Purpose |
|--------|------|---------|
| `GetProcesses` | Unary | Get running processes |
| `Heartbeat` | Unary | Keep-alive |
| `GetDebugDiagnostics` | Unary | Debug info |
| `GetBrainStatus` | Unary | Brain/indexing status |
| `HandleStreamingCommand` | Unary | Handle streaming commands |
| `HandleStreamingTab` | Unary | Handle streaming tab |
| `HandleStreamingTerminalCommand` | Unary | Handle terminal commands |
| `StreamTerminalShellCommand` | Unary | Stream terminal output |
| `ReadTerminal` | Unary | Read terminal content |
| `GetDeepWiki` | Unary | Deep wiki lookup |
| `GetWebDocsOptions` | Unary | Web documentation options |

### Service 2: `exa.extension_server_pb.ExtensionServerService`

Manages the lifecycle of the language server process.

| Method | Type | Purpose |
|--------|------|---------|
| `LanguageServerStarted` | Unary | Notify that the language server has started, returns ports and CSRF token |

### Service 3: `exa.seat_management_pb.SeatManagementService`

Handles user registration and team management.

| Method | Type | Purpose |
|--------|------|---------|
| `RegisterUser` | Unary | Register a new user (Firebase auth) |
| `GetUserStatus` | Unary | Get user account status |
| `GetCurrentUser` | Unary | Get current user info |
| `GetAuthToken` | Unary | Get auth token |
| `GetOneTimeAuthToken` | Unary | Get one-time auth token |
| `MigrateApiKey` | Unary | Migrate legacy API key |
| `ProvisionTeam` | Unary | Create a team |
| `ProvisionCascadeSeats` | Unary | Provision team seats |
| `GetTeamInfo/Settings/Billing` | Unary | Team management |
| `GetStripeSubscriptionState` | Unary | Billing state |
| `SubscribeToPlan` | Unary | Subscribe to a plan |
| `PurchaseCascadeCredits` | Unary | Buy credits |

### Service 4: `exa.product_analytics_pb.ProductAnalyticsService`

Telemetry and analytics.

| Method | Type | Purpose |
|--------|------|---------|
| `RecordAnalyticsEvent` | Unary | Record a product event |

### Service 5: `exa.dev_pb.DevService`

Developer/debug tools.

| Method | Type | Purpose |
|--------|------|---------|
| `Dev` | Unary | Generic dev/debug endpoint |

---

## Cascade Chat Session Lifecycle

### Phase 1: Initialization

```
Extension starts up
    │
    ▼
Spawn language_server_linux_x64 binary
    │
    ▼
ExtensionServerService.LanguageServerStarted()
    │  Returns: languageServerPort, lspPort, chatClientPort, csrfToken
    ▼
Create ConnectRPC transport to localhost:{languageServerPort}
    │
    ▼
Create LanguageServerService client
    │
    ▼
MetadataProvider loads API key
    │
    ▼
Ready for Cascade sessions
```

### Phase 2: New Chat Session

```
User opens Cascade panel or sends first message
    │
    ▼
LanguageServerService.StartCascade({
    metadata: { apiKey, ideInfo... },
    baseTrajectoryIdentifier: { ... }
})
    │  Returns: cascadeId, arenaCascadeIds[]
    ▼
Subscribe to StreamCascadeReactiveUpdates({ cascadeId })
    │  Server-streaming: receives real-time updates
    ▼
Subscribe to StreamCascadePanelReactiveUpdates({ cascadeId })
    │  Server-streaming: receives UI state updates
    ▼
Session is active, cascadeId stored
```

### Phase 3: Sending Messages

```
User types a message and hits Enter
    │
    ▼
LanguageServerService.SendUserCascadeMessage({
    metadata: { apiKey, ideInfo... },
    cascadeId: "session-uuid",
    items: [
        { text: "user message" },
        { scopeItem: { file, range, content } }  // attached context
    ],
    cascadeConfig: { model, temperature, ... }
})
    │
    ▼
Language server processes locally:
  - Gathers additional context (code maps, workspace info)
  - Constructs full prompt with system instructions
  - Sends to Codeium cloud (inference.codeium.com)
    │
    ▼
Responses stream back via StreamCascadeReactiveUpdates:
  - Text chunks (assistant response)
  - Code edit proposals
  - Tool calls (file reads, terminal commands, etc.)
  - Status updates (thinking, executing, done)
    │
    ▼
Extension renders updates in the Cascade panel
```

### Phase 4: Code Edits

```
Cascade proposes a code edit
    │
    ▼
Extension shows diff in editor
    │
    ▼
User accepts/rejects
    │
    ▼
If accepted: WriteCascadeEdit({ ... })
    │
    ▼
AcknowledgeCascadeCodeEdit({ ... })
    │
    ▼
If user wants to revert later:
    GetRevertPreview({ cascadeId, stepIndex })
    RevertToCascadeStep({ cascadeId, stepIndex })
```

### Phase 5: Session End

```
User closes panel or starts new conversation
    │
    ▼
LogCascadeSession({ cascadeId, ... })
    │
    ▼
RecordChatPanelSession({ ... })
    │
    ▼
Trajectory saved for history (GetAllCascadeTrajectories)
```

---

## API Server Endpoints & Routing

### Default Endpoints

| Service | URL | Protocol |
|---------|-----|----------|
| Main API | `https://server.codeium.com` | ConnectRPC / HTTP/2 |
| Registration | `https://register.windsurf.com` | ConnectRPC / HTTP/1.1 |
| Inference | `https://inference.codeium.com` | ConnectRPC / HTTP/2 |
| Feature Flags | `https://unleash.codeium.com/api/` | REST |
| Documentation | `https://docs.windsurf.com` | HTTPS |
| Source Maps | `https://cdn.windsurf.com/sourcemaps/` | HTTPS |

### Regional Routing

| Region | API Server | Inference Server |
|--------|-----------|-----------------|
| **Default (US)** | `server.codeium.com` | `inference.codeium.com` |
| **EU** | `eu.windsurf.com/_route/api_server` | `eu.windsurf.com/_route/api_server` |
| **FedStart (Gov)** | `windsurf.fedstart.com/_route/api_server` | `windsurf.fedstart.com/_route/api_server` |
| **Custom (Enterprise)** | `{serviceUrl}/_route/api_server` | `{serviceUrl}/_route/api_server` |

### VS Code Settings for URL Override

```json
{
    "codeium.apiServerUrl": "https://server.codeium.com",
    "codeium.registerApiServerUrl": "https://register.windsurf.com",
    "codeium.inferenceApiServerUrl": "https://inference.codeium.com",
    "codeiumDev.externalLanguageServerAddress": "",
    "windsurf.serviceUrl": ""
}
```

Setting `windsurf.serviceUrl` to a custom URL automatically derives both API and inference URLs as `{url}/_route/api_server`.

---

## Authentication & Security

### API Key Lifecycle

```
1. User logs in via Firebase Auth (Google, GitHub, email)
       │
       ▼
2. SeatManagementService.RegisterUser({ firebaseIdToken })
       │  Returns: apiKey, name
       ▼
3. API key stored in MetadataProvider
       │
       ▼
4. Every RPC includes Metadata { apiKey, ideInfo }
       │
       ▼
5. Key migration: MigrateApiKey() converts legacy → sk-ws-01-* format
```

### API Key Formats

| Format | Description |
|--------|-------------|
| `sk-ws-01-...` | New Windsurf API key format |
| Plain string | Legacy Codeium API key |
| `devin-session-token$...` | Devin integration session token |

### Security Layers

1. **CSRF Token** — Protects local language server from cross-site requests. Set as `x-codeium-csrf-token` header.
2. **API Key** — Sent in Protobuf `Metadata` message (not as HTTP header). Identifies the user.
3. **Auth Token** — Firebase-based authentication token for initial registration.
4. **One-Time Auth Token** — For specific operations like account linking.

### Unleash Feature Flags Auth

```
Authorization header: "*:production.ead56b58a77f5ac50d9aa4f987fe381cd78473..."
```

For staging environments, a different key is used.

---

## Feature Flags & Experimentation

Windsurf uses **Unleash** (self-hosted at `unleash.codeium.com`) for feature flags and experimentation.

### Key Methods

- `GetUnleashData` — Fetch feature flag state
- `ShouldEnableUnleash` — Check if Unleash should be active
- `SetBaseExperiments` / `UpdateDevExperiments` — Manage experiments

### Other Experimentation Frameworks Referenced

The codebase also references these (likely for different purposes):
- `GrowthBook`
- `LaunchDarkly`
- `OpenFeature`
- `Statsig`

---

## Key Dependencies & Tech Stack

### Runtime Dependencies (from `package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| `@bufbuild/protobuf` | ^1.10.0 | Protocol Buffers runtime |
| `@connectrpc/connect` | ^1.6.1 | ConnectRPC client |
| `@connectrpc/connect-web` | ^1.6.1 | ConnectRPC web transport |
| `preact` | ^10.24.3 | Lightweight UI rendering |
| `react` / `react-dom` | ^19.2.0 | UI components (Cascade panel) |
| `zustand` | ^5.0.0 | State management |
| `motion` | ^12.23.24 | Animations |
| `unleash-client` | ^6.1.1 | Feature flags |
| `unleash-proxy-client` | ^3.7.6 | Feature flag proxy |
| `undici` | ^7.9.0 | HTTP client |
| `mermaid` | ^11.12.1 | Diagram rendering |
| `katex` | ^0.16.22 | Math rendering |
| `node-pty` | 1.1.0-beta35 | Terminal emulation |

### Build-Time Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@bufbuild/buf` | 1.36.0 | Buf CLI (proto compilation) |
| `@bufbuild/protoc-gen-es` | 1.9.0 | Protobuf → TypeScript codegen |
| `@connectrpc/protoc-gen-connect-es` | 1.4.0 | ConnectRPC → TypeScript codegen |
| `electron` | 37.7.0 | Desktop shell |
| `typescript` | 6.0.0-dev | TypeScript compiler |

### Protobuf Schema Files (from build scripts)

```
exa/language_server_pb/language_server.proto
exa/product_analytics_pb/product_analytics.proto
exa/cascade_plugins_pb/cascade_plugins.proto
exa/seat_management_pb/seat_management.proto
exa/extension_server_pb/extension_server.proto
exa/browser_preview_pb/browser_preview.proto
exa/codeium_common_pb/codeium_common.proto
exa/chat_client_server_pb/chat_client_server.proto
exa/dev_pb/dev.proto
```

---

## Interesting Discoveries

### 1. Windsurf Does NOT Use OpenAI-Compatible APIs Internally

Despite the existence of `https://api.codeium.com/v1/chat/completions`, Cascade internally uses a completely proprietary ConnectRPC + Protobuf protocol. The OpenAI-compatible endpoint (if publicly available) would be a separate product offering, not what the IDE uses.

### 2. Arena Mode (Model Comparison)

Windsurf has a built-in **arena mode** where multiple models can be compared side-by-side:
- `SpawnArenaModeMidConversation` — Start arena mode during a conversation
- `ConvergeArenaCascades` — Merge results from arena mode
- `ArenaAssignment`, `ArenaConfig`, `ArenaTier` — Configuration types
- `StartCascadeResponse` returns `arenaCascadeIds[]` — Multiple parallel sessions

### 3. Cascade Plugins System

A plugin system exists for extending Cascade:
- `GetAvailableCascadePlugins` / `GetCascadePluginById`
- `InstallCascadePlugin`
- `OpenConfigurePluginsPage` / `OpenPluginConfigModal`
- Proto types: `CascadePluginTemplate`, `CascadePluginLocalConfig`, `CascadePluginCommand`

### 4. Code Maps

Windsurf maintains "code maps" — structured representations of codebases:
- `GetCodeMapsForFile` / `GetCodeMapsForRepos`
- `GetCodeMapSuggestions`
- `LoadCodeMap` / `SaveCodeMapFromJson`
- `ShareCodeMap` / `GetSharedCodeMap`
- `BranchCascadeAndGenerateCodeMap` — Generate code map during branching

### 5. Browser Preview Integration

A browser preview system with interaction tracking:
- `browser_preview_pb` proto definition
- `BrowserInteraction`, `BrowserClickInteraction`, `BrowserPageMetadata` types
- Suggests Windsurf can observe and interact with browser previews

### 6. Devin Integration

References to Devin (the AI software engineer):
- `devin-session-token$` API key prefix
- `cascadeplayground.watchdevinwork.com/cascade_query/` endpoint
- `ReplayGroundTruthTrajectory` — Replay recorded trajectories

### 7. User Settings Stored as Protobuf

User settings are stored in `~/.codeium/windsurf/user_settings.pb` — a binary Protobuf file, not JSON. This is unusual for a VS Code-based editor and suggests tight integration with the protobuf-based backend.

### 8. Multi-Tenant Architecture

Windsurf supports multi-tenant deployments:
- `GetMultiTenantTeams`
- `MULTI_TENANT_MODE` configuration flag
- Custom `windsurf.serviceUrl` for enterprise deployments
- EU and FedStart regional deployments

### 9. Netlify Integration

Built-in deployment support:
- `GetNetlifyAccountStatus`
- `GetWindsurfJSAppDeployment`
- `SaveWindsurfJSAppProjectName`
- `ValidateWindsurfJSAppProjectName`

### 10. Audio Recording / Transcription

Voice input capabilities:
- `StartAudioRecording`
- `GetCurrentAudioRecording`
- `GetTranscription`

### 11. Sentry Error Tracking

The extension uses Sentry for error monitoring:
- Source maps hosted at `cdn.windsurf.com/sourcemaps/`
- Various Sentry integrations: `InboundFilters`, `LinkedErrors`, `RewriteFrames`, etc.

### 12. GitHub Integration

Deep GitHub integration:
- `GetGitHubAccessToken`
- `GetGitHubAccountStatus`
- `GetGithubPullRequestSearchInfo`
- `UpdateAutoCascadeGithubCredentials`

### 13. The Language Server is the Brain

The local language server binary is not just a proxy — it's the core intelligence layer:
- Manages all Cascade sessions locally
- Handles context gathering (code maps, file indexing)
- Manages the message queue
- Tracks trajectories and steps
- Communicates with the cloud for inference
- Exposes three separate ports (RPC, LSP, chat client)

### 14. Rate Limiting

Built-in rate limiting:
- `CheckUserMessageRateLimit` — Check before sending
- `CheckChatCapacity` — Check available capacity
- `GetUsageConfig` — Get usage limits

### 15. BYOK (Bring Your Own Key)

Users can configure their own API provider keys:
- `GetSetUserApiProviderKeys`
- `SetUserApiProviderKey`
- `ApiProviderConfig`, `ApiProviderConfigMap`, `ApiProviderRoutingConfig` types
- Supports routing to different providers

---

## Conclusion

Windsurf's architecture is significantly more sophisticated than a simple "chat with an LLM" application. It uses:

- **ConnectRPC + Protobuf** instead of REST/JSON for all internal communication
- A **local native binary** as an intelligence proxy between the IDE and cloud
- **Server-streaming RPCs** for real-time response delivery
- A **rich protobuf schema** with 250+ RPC methods covering everything from code edits to audio transcription
- **Multi-region, multi-tenant** deployment support
- **Arena mode** for model comparison
- **Plugin system** for extensibility
- **Code maps** for structured codebase understanding

The key takeaway: if you want to programmatically interact with Windsurf's Cascade, you would need to either:
1. Use the local language server binary's ConnectRPC interface (requires CSRF token)
2. Wait for an official public API (the `api.codeium.com` endpoint may serve this purpose)
3. Use the Windsurf extension's command palette commands as a higher-level interface
