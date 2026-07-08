# PR plan: fix MCP facade late-registration in search mode

Source rejection: KunAgent/Kun#697.

## Problem

MCP search mode can skip direct MCP provider registration. If a server with resources/prompts becomes connected only after startup through OAuth authorization or background reconnect, resources/prompts facade tools are not guaranteed to become available.

## Implemented on this branch

- Extended `McpClientLike` with optional resources/prompts methods.
- Forwarded optional resources/prompts SDK methods through `mcp-transport.ts`.
- Added `mcp-facade-provider.ts`, a stable provider that exposes:
  - `mcp_list_resources`
  - `mcp_read_resource`
  - `mcp_list_resource_templates`
  - `mcp_list_prompts`
  - `mcp_get_prompt`
- Facade tools gate advertise/execute against current live `connected[]` state, workspace visibility, and trust scope.

## Still to wire

- Import and push `createMcpFacadeProvider(connected)` in `mcp-tool-provider.ts` regardless of search mode.
- Update advertised diagnostics accordingly.
- Add late OAuth/background reconnect regression tests.

## Review checklist

- Confirm the facade provider is registered in both search and direct mode.
- Confirm search mode still avoids duplicate direct per-server tool providers.
- Confirm OAuth late connect and background reconnect only need to push new connection state.
