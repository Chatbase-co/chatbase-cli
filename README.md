# chatbase

The official CLI for the [Chatbase API v2](https://www.chatbase.co/docs/api-v2/overview).

## Install

```sh
npm install -g chatbase   # or: npx chatbase <command>
```

Requires Node 20+.

### Uninstall

```sh
npm uninstall -g chatbase
rm -rf ~/.config/chatbase ~/.local/state/chatbase ~/.cache/chatbase
```

## Authenticate

```sh
chatbase auth login                       # interactive (paste your API key)
chatbase auth login --with-token < key.txt
export CHATBASE_API_KEY=...               # CI
```

Keys live in chatbase.co → Workspace Settings → API Keys (Standard plan or higher).

## Privacy

The CLI sends no telemetry. Requests carry a `chatbase-cli/<version>` User-Agent so
Chatbase can distinguish CLI traffic server-side. The only network calls are the API
calls you invoke.

<!-- commands -->
<!-- commandsstop -->
