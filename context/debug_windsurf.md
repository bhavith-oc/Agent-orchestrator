# Debugging Windsurf: Step-by-Step Command Log

This document records every command used to reverse-engineer how the Windsurf IDE sends API calls for Cascade chat sessions, along with explanations and findings for each step.

---

## Step 1 — Locate the Windsurf Installation

### Command

```bash
which windsurf 2>/dev/null
find /usr/share/applications /usr/local/share/applications /opt /snap -maxdepth 3 -iname '*windsurf*' 2>/dev/null
find /home/oc -maxdepth 3 -iname '*windsurf*' -not -path '*/Desktop/Agent-orchestrator/*' 2>/dev/null
```

### Explanation

We need to find where Windsurf is installed on the system. `which` finds the binary, `find` searches common install locations and the home directory for any Windsurf-related files.

### Findings

- **Binary:** `/usr/bin/windsurf`
- **Desktop entries:** `/usr/share/applications/windsurf.desktop`, `/usr/share/applications/windsurf-url-handler.desktop`
- **User config:** `/home/oc/.config/Windsurf/`
- **User data:** `/home/oc/.codeium/windsurf/`
- **Extensions:** `/home/oc/.windsurf/extensions/`

---

## Step 2 — Resolve the Actual Binary Path

### Command

```bash
readlink -f /usr/bin/windsurf
```

### Explanation

`/usr/bin/windsurf` is likely a symlink. `readlink -f` resolves it to the real path.

### Findings

- Resolved to: `/usr/share/windsurf/bin/windsurf`
- This confirms the main installation lives under `/usr/share/windsurf/`.

---

## Step 3 — Explore the Codeium User Data Directory

### Command

```bash
ls /home/oc/.codeium/windsurf/
```

### Explanation

The `.codeium/windsurf/` directory stores user-specific runtime data. Exploring it reveals what local state Windsurf maintains.

### Findings

Key contents:
- `installation_id` — 36-byte unique installation identifier
- `user_settings.pb` — User settings stored in **Protobuf binary format** (not JSON!)
- `mcp_config.json` — MCP server configuration
- `brain/`, `cascade/`, `memories/`, `recipes/`, `codemaps/` — Empty directories for various Cascade features
- `database/`, `context_state/`, `implicit/` — Local state directories

**Key insight:** The `.pb` extension on `user_settings.pb` was the first hint that Windsurf uses **Protocol Buffers** internally.

---

## Step 4 — Explore the User Config Directory

### Command

```bash
ls /home/oc/.config/Windsurf/
```

### Explanation

Standard Electron app config location. Contains browser-level data (cookies, cache, local storage).

### Findings

Standard Electron/Chromium data: `Cookies`, `Cache/`, `Local Storage/`, `Session Storage/`, `GPUCache/`, `logs/`, `machineid`, etc. Nothing API-specific here — this is the Electron shell layer.

---

## Step 5 — Explore the Main Installation Directory

### Command

```bash
ls /usr/share/windsurf/
ls /usr/share/windsurf/resources/
ls /usr/share/windsurf/resources/app/
```

### Explanation

Following the standard Electron app structure: the real application code lives under `resources/app/`.

### Findings

- `/usr/share/windsurf/resources/app/` contains:
  - `package.json` — App metadata and dependencies
  - `product.json` — Product configuration (extensions, telemetry, etc.)
  - `out/` — Compiled JavaScript source
  - `extensions/` — Built-in extensions
  - `node_modules.asar` — Bundled node modules

---

## Step 6 — Read product.json for API Configuration

### Command

```bash
# Read the file directly (used IDE read_file tool)
cat /usr/share/windsurf/resources/app/product.json
```

### Explanation

`product.json` is the VS Code / Windsurf product configuration. It contains extension marketplace URLs, telemetry keys, and other service endpoints.

### Findings

- **App name:** Windsurf (by Exafunction, Inc.)
- **Version:** 1.106.0
- **Marketplace:** `https://marketplace.windsurf.com/vscode/gallery`
- **aiConfig.ariaKey:** `"windsurf"`
- **Zendesk ticket API key** found (hashed)
- **Extension gallery** points to Windsurf's own marketplace, not Microsoft's
- **Windsurf-specific keys** start after `____________EXTRA_WINDSURF_KEYS_START_HERE_______________`

---

## Step 7 — Read package.json for Dependencies

### Command

```bash
cat /usr/share/windsurf/resources/app/package.json
```

### Explanation

The `package.json` reveals what libraries Windsurf uses, which tells us about the communication protocol.

### Findings

**Critical dependencies revealing the protocol:**
- `@bufbuild/protobuf: ^1.10.0` — Protocol Buffers runtime
- `@connectrpc/connect: ^1.6.1` — **ConnectRPC client** (the transport layer!)
- `@connectrpc/connect-web: ^1.6.1` — ConnectRPC web transport

**Dev dependencies confirming protobuf usage:**
- `@bufbuild/buf: 1.36.0` — Buf CLI for proto compilation
- `@bufbuild/protoc-gen-es: 1.9.0` — Protobuf code generator
- `@connectrpc/protoc-gen-connect-es: 1.4.0` — ConnectRPC code generator

**Build scripts revealing proto sources:**
```bash
protoc: buf generate .. \
  --path ../exa/language_server_pb/language_server.proto \
  --path ../exa/product_analytics_pb/product_analytics.proto \
  --path ../exa/cascade_plugins_pb/cascade_plugins.proto \
  --path ../exa/seat_management_pb/seat_management.proto \
  --path ../exa/extension_server_pb/extension_server.proto \
  --path ../exa/browser_preview_pb/browser_preview.proto \
  --path ../exa/codeium_common_pb/codeium_common.proto \
  --path ../exa/chat_client_server_pb/chat_client_server.proto \
  --path ../exa/dev_pb/dev.proto
```

**Key insight:** This confirmed Windsurf uses **ConnectRPC with Protobuf**, not REST/JSON. The `exa/` prefix in proto paths refers to Exafunction's internal proto definitions.

---

## Step 8 — Find Files Containing "codeium" in Compiled Source

### Command

```bash
grep -rl "codeium" /usr/share/windsurf/resources/app/out/ --include="*.js" 2>/dev/null | head -20
```

### Explanation

Search the compiled JavaScript output for any file referencing "codeium" to find where API logic lives.

### Findings

Files containing "codeium":
- `out/main.js` — Electron main process
- `out/cli.js` — CLI entry point
- `out/bootstrap-fork.js` — Process forking
- `out/vs/workbench/workbench.desktop.main.js` — Main workbench bundle
- `out/vs/code/node/cliProcessMain.js`
- `out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js`
- `out/vs/workbench/api/node/extensionHostProcess.js`

---

## Step 9 — Find the Windsurf Extension Directory

### Command

```bash
find /usr/share/windsurf/resources/app/extensions -maxdepth 2 -name "*.json" -path "*windsurf*" 2>/dev/null
find /usr/share/windsurf/resources/app/extensions -maxdepth 1 -type d 2>/dev/null | head -20
```

### Explanation

The core Cascade logic lives in the built-in Windsurf extension, not the VS Code workbench layer.

### Findings

- **Core extension:** `/usr/share/windsurf/resources/app/extensions/windsurf/`
- Contains:
  - `dist/extension.js` — The main compiled extension (~9MB minified)
  - `bin/language_server_linux_x64` — The local language server binary
  - `bin/fd` — File discovery tool
  - `schemas/mcp_config.schema.json` — MCP config schema

---

## Step 10 — Extract All URLs from the Extension

### Command

```bash
grep -oP 'https?://[a-zA-Z0-9._:/-]+' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | sort -u | grep -iv 'github|microsoft|vscode|nodejs|chromium|w3|mozilla|google|apple|schema.org|json-schema|creativecommons|xml|swagger|openapi' | head -50
```

### Explanation

Extract all hardcoded URLs from the minified extension code, filtering out irrelevant third-party URLs.

### Findings

**Codeium/Windsurf API endpoints discovered:**
- `https://server.codeium.com` — Main API server
- `https://register.windsurf.com` — User registration
- `https://inference.codeium.com` — Model inference
- `https://eu.windsurf.com` — EU region
- `https://eu.windsurf.com/_route/api_server` — EU API route
- `https://windsurf.fedstart.com` — FedStart (government) region
- `https://windsurf.fedstart.com/_route/api_server` — FedStart API route
- `https://unleash.codeium.com/api/` — Feature flags (Unleash)
- `https://docs.windsurf.com` — Documentation
- `https://cdn.windsurf.com/sourcemaps/...` — Source maps CDN
- `https://cascadeplayground.watchdevinwork.com/cascade_query/` — Cascade playground
- `http://localhost:8969/stream` — Local streaming endpoint

---

## Step 11 — Extract Protobuf Service Definitions

### Command

```bash
grep -oP 'typeName:"[^"]*"' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | sort -u
```

### Explanation

In ConnectRPC generated code, each service has a `typeName` field. Extracting these reveals all the gRPC/Connect services.

### Findings

**Five protobuf services identified:**
1. `exa.language_server_pb.LanguageServerService` — Core service (Cascade, completions, code edits)
2. `exa.extension_server_pb.ExtensionServerService` — Extension lifecycle management
3. `exa.seat_management_pb.SeatManagementService` — User registration and auth
4. `exa.product_analytics_pb.ProductAnalyticsService` — Telemetry and analytics
5. `exa.dev_pb.DevService` — Developer/debug tools

---

## Step 12 — Extract All RPC Method Names

### Command

```bash
grep -oP 'name:"[A-Z][a-zA-Z]+"' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | sort -u
```

### Explanation

Each RPC method in the protobuf service definition has a `name:` field starting with an uppercase letter. This extracts all method names.

### Findings

**250+ RPC methods discovered.** Key Cascade-related methods:
- `StartCascade` — Create a new Cascade session
- `SendUserCascadeMessage` — Send user input to Cascade
- `QueueCascadeMessage` — Queue a message
- `StreamCascadeReactiveUpdates` — Server-streaming responses
- `StreamCascadePanelReactiveUpdates` — UI panel streaming
- `StreamCascadeSummariesReactiveUpdates` — Summary streaming
- `BranchCascade` — Branch a conversation
- `CancelCascadeInvocation` — Cancel in-flight request
- `CancelCascadeSteps` — Cancel specific steps
- `GetCascadeTrajectory` — Get conversation history
- `GetCascadeTrajectorySteps` — Get step details
- `GetCascadeMemories` — Retrieve memories
- `UpdateCascadeMemory` — Update a memory
- `HandleCascadeUserInteraction` — Handle user interactions
- `WriteCascadeEdit` — Write code edits
- `RevertToCascadeStep` — Revert to a previous step
- `GetCascadeModelConfigs` — Get model configurations
- `GetCascadeAnalytics` — Get analytics data
- `LogCascadeSession` — Log session data
- `SpawnArenaModeMidConversation` — Arena mode (model comparison)

---

## Step 13 — Analyze the ConnectRPC Transport Setup

### Command

```bash
grep -oP 'createConnectTransport|createGrpcTransport|createGrpcWebTransport' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | sort | uniq -c
```

### Explanation

Count how many times each transport factory is used to understand the communication protocol.

### Findings

- `createConnectTransport` — **4 usages** (primary transport)
- `createGrpcTransport` — 1 usage
- `createGrpcWebTransport` — 1 usage

ConnectRPC is the dominant transport.

---

## Step 14 — Extract Transport Configuration Details

### Command

```bash
grep -oP '.{0,100}createConnectTransport.{0,200}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null
```

### Explanation

Get the surrounding context of each `createConnectTransport` call to see how they're configured.

### Findings

**Four distinct transport instances:**

1. **Language Server Client** (local, HTTP/1.1):
   ```javascript
   createConnectTransport({
     baseUrl: `http://${this.process.address}`,
     useBinaryFormat: true,
     httpVersion: "1.1",
     interceptors: [csrfInterceptor]  // adds x-codeium-csrf-token header
   })
   ```
   Used with: `LanguageServerService`

2. **Registration Client** (remote, HTTP/1.1):
   ```javascript
   createConnectTransport({
     baseUrl: getRegisterApiServerUrl(),  // https://register.windsurf.com
     useBinaryFormat: true,
     httpVersion: "1.1"
   })
   ```
   Used with: `SeatManagementService`

3. **Product Analytics Client** (remote, HTTP/2):
   ```javascript
   createConnectTransport({
     baseUrl: getApiServerUrlFromContext(ctx),  // https://server.codeium.com
     useBinaryFormat: true,
     httpVersion: "2"
   })
   ```
   Used with: `ProductAnalyticsService`

4. **Library export** — The ConnectRPC library itself exports the factory function.

---

## Step 15 — Analyze the API Server URL Resolution

### Command

```bash
grep -oP '.{0,50}getApiServerUrl[a-zA-Z]*\b.{0,150}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js
grep -oP '.{0,50}getRegisterApiServerUrl.{0,150}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js
```

### Explanation

Understand how the extension resolves which API server to talk to.

### Findings

**URL resolution logic:**
- `getApiServerUrl(apiServerUrl)` — Returns the configured URL or falls back to default
- `getApiServerUrlFromContext(ctx)` — Checks VS Code config `codeium.apiServerUrl`, falls back to `DEFAULT_API_SERVER_URL`
- `getRegisterApiServerUrl()` — Checks config, falls back to `DEFAULT_REGISTER_API_SERVER_URL`

**The extension initializes the language server client with:**
```javascript
const apiServerUrl = getApiServerUrlFromContext(ctx);
LanguageServerClient.initialize(languageServer, apiServerUrl);
```

---

## Step 16 — Extract Default API Server URLs

### Command

```bash
grep -oP '.{0,30}DEFAULT_API_SERVER_URL.{0,150}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js
grep -oP '.{0,30}REGISTER_API_SERVER_URL.{0,150}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js
grep -oP '.{0,30}INFERENCE_API_SERVER_URL.{0,150}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js
```

### Explanation

Find the hardcoded default values for all API server URLs.

### Findings

**Default URLs:**

| Config Key | Default Value |
|-----------|---------------|
| `DEFAULT_API_SERVER_URL` | `https://server.codeium.com` |
| `DEFAULT_REGISTER_API_SERVER_URL` | `https://register.windsurf.com` |
| `INFERENCE_API_SERVER_URL` | `https://inference.codeium.com` |

**VS Code setting names:**

| Setting | Purpose |
|---------|---------|
| `codeium.apiServerUrl` | Main API server |
| `codeium.registerApiServerUrl` | Registration server |
| `codeium.inferenceApiServerUrl` | Inference server |
| `codeiumDev.externalLanguageServerAddress` | External language server |

**Regional overrides:**
- **EU:** API + Inference → `https://eu.windsurf.com/_route/api_server`
- **FedStart:** API + Inference → `https://windsurf.fedstart.com/_route/api_server`
- **Custom:** Any `windsurf.serviceUrl` setting → `${url}/_route/api_server`

---

## Step 17 — Analyze the Cascade Message Flow

### Command

```bash
grep -oP 'SendUserCascadeMessage|StartCascade|QueueCascadeMessage|StreamCascade[a-zA-Z]+' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | sort | uniq -c
```

### Explanation

Count occurrences of key Cascade RPC methods to understand which are most used.

### Findings

| Method | Occurrences | Type |
|--------|-------------|------|
| `SendUserCascadeMessage` | 11 | Unary RPC |
| `StartCascade` | 9 | Unary RPC |
| `QueueCascadeMessage` | 9 | Unary RPC |
| `StreamCascadeReactiveUpdates` | 1 | Server-Streaming RPC |
| `StreamCascadePanelReactiveUpdates` | 1 | Server-Streaming RPC |
| `StreamCascadeSummariesReactiveUpdates` | 1 | Server-Streaming RPC |

---

## Step 18 — Analyze the SendUserCascadeMessage Request Structure

### Command

```bash
grep -oP '.{0,80}SendUserCascadeMessage.{0,200}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | head -5
```

### Explanation

Get the protobuf field definitions and usage context for the main message-sending RPC.

### Findings

**`SendUserCascadeMessageRequest` protobuf fields:**
- Field 3: `metadata` (message type: `Metadata`) — API key, IDE info
- Field 1: `cascade_id` (string) — Session identifier
- Field 2: `items` (repeated message: `TextOrScopeItem`) — User text and context
- Additional: `cascadeConfig` — Configuration for the cascade session

**Usage in extension code:**
```javascript
await LanguageServerClient.getInstance().client.sendUserCascadeMessage(
  new SendUserCascadeMessageRequest({
    metadata: MetadataProvider.getInstance().getMetadata(),
    cascadeId: sessionId,
    items: userItems,
    cascadeConfig: config
  })
)
```

---

## Step 19 — Analyze the StartCascade Request Structure

### Command

```bash
grep -oP '.{0,80}StartCascade.{0,200}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | head -5
```

### Explanation

Understand how new Cascade sessions are created.

### Findings

**`StartCascadeRequest` protobuf fields:**
- Field 1: `metadata` (message: `Metadata`)
- Field 3: `base_trajectory_identifier` (message: `BaseTrajectoryIdentifier`)
- Field 4+: Additional configuration fields

**`StartCascadeResponse`:**
- `cascadeId` (string) — The new session ID
- `arenaCascadeIds` (repeated string) — IDs for arena mode comparisons

---

## Step 20 — Analyze the Language Server Process

### Command

```bash
grep -oP '.{0,80}chatClientPort.{0,150}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | head -10
grep -oP '.{0,80}language_server_linux_x64.{0,200}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | head -3
```

### Explanation

Understand the language server binary's role and what ports it exposes.

### Findings

**Language server process exposes three ports:**
```javascript
// From ExtensionServerService response protobuf
languageServerPort = 0;  // Main RPC port
lspPort = 0;             // LSP protocol port
chatClientPort = 0;      // Chat client port
csrfToken = "";          // CSRF token for auth
```

**Binary selection by platform:**
```javascript
case LINUX_ARM:   return "language_server_linux_arm"
case LINUX_X64:   return "language_server_linux_x64"
case MACOS_ARM:   return "language_server_macos_arm"
case MACOS_X64:   return "language_server_macos_x64"
case WINDOWS_X64: return "language_server_windows_x64.exe"
```

---

## Step 21 — Analyze Authentication Mechanism

### Command

```bash
grep -oP '.{0,50}api_key.{0,100}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | grep -i 'header|token|auth|metadata' | head -5
grep -oP '.{0,50}Metadata.{0,200}' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | grep -i 'api_key|apiKey|ide_name|ide_version|extension_version' | head -5
```

### Explanation

Understand how authentication works — where the API key is stored and how it's sent.

### Findings

**Authentication fields in the `Metadata` protobuf message:**
- `auth_token` (field 1, string)
- `api_key` (field 2, string)

**API key formats:**
- New format: `sk-ws-01-...` prefix
- Legacy format: plain string
- Devin sessions: `devin-session-token$...` prefix

**Key management:**
- `MetadataProvider.getInstance().getMetadata().apiKey` — Access current key
- `MetadataProvider.getInstance().updateApiKey(key)` — Update key
- `MigrateApiKey` RPC — Migrate from legacy to new format
- `GetPrimaryApiKeyForDevsOnly` RPC — Get the underlying primary key

**CSRF protection:**
- Every request to the local language server includes `x-codeium-csrf-token` header
- Token is provided by the `ExtensionServerService` on startup

---

## Step 22 — Extract Cascade-Related Protobuf Type Names

### Command

```bash
grep -oP 'exa\.language_server_pb\.[A-Za-z]+' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | sort -u | grep -i 'cascade|chat|message'
```

### Explanation

Find all protobuf message types related to Cascade and chat.

### Findings

**Cascade-related protobuf types in `exa.language_server_pb`:**
- `AcknowledgeCascadeCodeEditRequest/Response`
- `BranchCascadeRequest/Response`
- `BranchCascadeAndGenerateCodeMapRequest/Response`
- `CancelCascadeInvocationRequest/Response`
- `CancelCascadeInvocationAndWaitRequest/Response`
- `CancelCascadeStepsRequest/Response`
- `CheckChatCapacityRequest/Response`
- `CheckUserMessageRateLimitRequest/Response`
- `ConvergeArenaCascadesRequest/Response`
- `DeleteCascadeMemoryRequest`
- `CommitMessageData`
- `SendUserCascadeMessageRequest/Response`
- `StartCascadeRequest/Response`
- `GetCascadeTrajectoryRequest/Response`

---

## Step 23 — Extract Common Protobuf Types

### Command

```bash
grep -oP 'exa\.codeium_common_pb\.[A-Za-z]+' \
  /usr/share/windsurf/resources/app/extensions/windsurf/dist/extension.js \
  2>/dev/null | sort -u | head -20
```

### Explanation

The `codeium_common_pb` package contains shared types used across all services.

### Findings

**Shared types include:**
- `Metadata` — Auth and IDE metadata sent with every request
- `AllowedModelConfig` — Model configuration
- `ApiProviderConfig` / `ApiProviderConfigMap` / `ApiProviderRoutingConfig` — Multi-provider routing
- `ArenaAssignment` / `ArenaConfig` / `ArenaTier` — Arena mode (model comparison)
- `TextOrScopeItem` — User input items
- `ActionPointer` — Code action references
- `BrowserInteraction` / `BrowserClickInteraction` — Browser preview interactions

---

## Summary

The investigation revealed that Windsurf uses a **completely proprietary protocol stack**:

1. **Protocol:** ConnectRPC with binary Protobuf (not REST/JSON)
2. **Architecture:** Extension → Local Language Server Binary → Codeium Cloud
3. **Transport:** HTTP/1.1 to local server, HTTP/2 to cloud
4. **Auth:** API key in Protobuf `Metadata` message + CSRF tokens for local communication
5. **Streaming:** Server-streaming RPCs for real-time Cascade responses
6. **No OpenAI-compatible endpoint** is used internally for Cascade sessions
