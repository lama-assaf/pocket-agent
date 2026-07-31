# GitHub account connection

## Design

Settings starts GitHub's OAuth device flow in the Electron main process. The main process requests a device code, opens GitHub's verification page, polls at GitHub's required interval, and returns only display-safe verification data/status to the renderer. On success it stores the access token encrypted at `github.token` and records `github.authMethod=oauth`; existing brain sync already reads `github.token`, so sync needs no changes. Cancellation uses `AbortController`; the flow also stops at GitHub's advertised expiry. No client secret is used or shipped.

## Register and configure the OAuth App

1. In the r3toAI GitHub organization, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set **Application name** to `r3to.os`, **Homepage URL** to the r3to.os project/site URL, and **Authorization callback URL** to any valid HTTPS project URL (device flow does not use it).
3. Create the app, then enable **Device Flow** in the app settings.
4. Copy the public **Client ID**. Set it in r3to.os **Settings → GitHub → OAuth App Client ID**, or set `POCKET_AGENT_GITHUB_CLIENT_ID` in the app environment. Do not create, enter, or bundle a client secret.
5. The flow requests `repo`, which grants read/write access to private repositories the connected user can access.

## Repository access

An r3toAI organization owner must invite every connected GitHub user as a collaborator with **Write** access to both r3toAI brain repositories (the agency/world brain repo and the client brain repo). In each repository use **Settings → Collaborators and teams → Add people**, select the user's GitHub account, and grant **Write**. If organization SAML SSO is enforced, the user must also authorize the OAuth token for the organization. Connection alone cannot grant repository membership.
