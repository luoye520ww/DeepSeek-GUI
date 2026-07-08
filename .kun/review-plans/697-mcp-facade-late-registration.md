# PR plan: fix MCP facade late-registration in search mode

Source rejection: KunAgent/Kun#697.

## Problem

MCP search mode can skip direct MCP provider registration. If a server with resources/prompts becomes connected only after startup through OAuth authorization or background reconnect, resources/prompts facade tools are not guaranteed to become available. The rejected implementation relied too much on startup-time provider registration.

## Implementation direction

1. Keep one stable MCP facade provider registered regardless of search mode.
2. Extend the MCP client abstraction with optional resource/prompt capabilities.
3. Gate facade tools by currently connected server capabilities at advertise/execute time.
4. Ensure OAuth authorization and background reconnect update the shared connected-state only; the stable facade observes that state instead of requiring late provider registration.
5. Avoid registering duplicate direct providers when search mode is active.

## Files expected to change

- `kun/src/adapters/tool/mcp-types.ts`
- `kun/src/adapters/tool/mcp-tool-provider.ts`
- MCP transport/client wrapper files
- MCP provider tests around search mode, OAuth authorization, and reconnect.

## Required tests

- Search mode starts with no resources/prompts-capable server; facade does not advertise unsupported tools.
- OAuth late connection introduces resources/prompts; facade tools become available without runtime restart.
- Background reconnect introduces resources/prompts; facade tools become available without direct provider late registration.
- Search mode still avoids duplicate direct tool providers.
