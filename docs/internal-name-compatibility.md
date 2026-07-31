# Retained legacy internal names

The user-facing product is **r3to.os**. The following `pocket-agent` names intentionally remain for compatibility or because they identify external infrastructure rather than the product label:

- npm package name `pocket-agent`, GitHub repositories/URLs, and CLI repository/install paths.
- Electron application ID `com.unstablemind.pocket-agent` and matching entitlement, preserving the existing application data/update identity.
- Existing database and storage paths (`pocket-agent.db`, Application Support/config directories, `Documents/Pocket-agent`) so upgrades keep user data.
- MCP server/tool protocol identifiers (`pocket-agent`, `mcp__pocket-agent__*`) because renaming breaks tool routing and integrations.
- Existing relay/chat service hostnames, OAuth originator/User-Agent identifiers, environment variable names, and temporary/test paths.
- Git author email and existing custom protocol identifiers where present.

Generated `dist/` files may contain these retained internals; user-visible generated labels are rebuilt from renamed source.
