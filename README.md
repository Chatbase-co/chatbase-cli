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
rm -rf ~/Library/Caches/chatbase   # macOS: update-check cache
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
* [`chatbase agents auto-retrain [AGENTID]`](#chatbase-agents-auto-retrain-agentid)
* [`chatbase agents clone AGENTID`](#chatbase-agents-clone-agentid)
* [`chatbase agents create`](#chatbase-agents-create)
* [`chatbase agents delete AGENTID`](#chatbase-agents-delete-agentid)
* [`chatbase agents get [AGENTID]`](#chatbase-agents-get-agentid)
* [`chatbase agents list`](#chatbase-agents-list)
* [`chatbase agents styles [AGENTID]`](#chatbase-agents-styles-agentid)
* [`chatbase agents train [AGENTID]`](#chatbase-agents-train-agentid)
* [`chatbase agents update [AGENTID]`](#chatbase-agents-update-agentid)
* [`chatbase api METHOD PATH`](#chatbase-api-method-path)
* [`chatbase auth login`](#chatbase-auth-login)
* [`chatbase auth logout`](#chatbase-auth-logout)
* [`chatbase auth status`](#chatbase-auth-status)
* [`chatbase chat`](#chatbase-chat)
* [`chatbase chat retry`](#chatbase-chat-retry)
* [`chatbase config get KEY`](#chatbase-config-get-key)
* [`chatbase config list`](#chatbase-config-list)
* [`chatbase config set KEY [VALUE]`](#chatbase-config-set-key-value)
* [`chatbase conversations export`](#chatbase-conversations-export)
* [`chatbase conversations get [CONVERSATIONID]`](#chatbase-conversations-get-conversationid)
* [`chatbase conversations list`](#chatbase-conversations-list)
* [`chatbase conversations tool-result [CONVERSATIONID]`](#chatbase-conversations-tool-result-conversationid)
* [`chatbase health`](#chatbase-health)
* [`chatbase help [COMMAND]`](#chatbase-help-command)
* [`chatbase helpdesk statuses`](#chatbase-helpdesk-statuses)
* [`chatbase helpdesk teams`](#chatbase-helpdesk-teams)
* [`chatbase messages feedback [MESSAGEID]`](#chatbase-messages-feedback-messageid)
* [`chatbase messages list`](#chatbase-messages-list)
* [`chatbase sources create`](#chatbase-sources-create)
* [`chatbase sources delete SOURCEID`](#chatbase-sources-delete-sourceid)
* [`chatbase sources get SOURCEID`](#chatbase-sources-get-sourceid)
* [`chatbase sources list`](#chatbase-sources-list)
* [`chatbase sources restore SOURCEID`](#chatbase-sources-restore-sourceid)
* [`chatbase sources summary`](#chatbase-sources-summary)
* [`chatbase sources update SOURCEID`](#chatbase-sources-update-sourceid)
* [`chatbase tickets create`](#chatbase-tickets-create)
* [`chatbase tickets get TICKETNUMBER`](#chatbase-tickets-get-ticketnumber)
* [`chatbase tickets list`](#chatbase-tickets-list)
* [`chatbase tickets messages [TICKETNUMBER]`](#chatbase-tickets-messages-ticketnumber)
* [`chatbase tickets reply [TICKETNUMBER]`](#chatbase-tickets-reply-ticketnumber)
* [`chatbase tickets search QUERY`](#chatbase-tickets-search-query)
* [`chatbase tickets update TICKETNUMBER`](#chatbase-tickets-update-ticketnumber)
* [`chatbase whatsapp send-template TEMPLATE`](#chatbase-whatsapp-send-template-template)
* [`chatbase whatsapp templates`](#chatbase-whatsapp-templates)

## `chatbase agents auto-retrain [AGENTID]`

Enable or disable automatic retraining for an agent

```
USAGE
  $ chatbase agents auto-retrain [AGENTID] [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>] [--enabled] [--disabled]

ARGUMENTS
  [AGENTID]  Agent ID

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --disabled            Disable automatic retraining
      --enabled             Enable automatic retraining
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Enable or disable automatic retraining for an agent

EXAMPLES
  $ chatbase agents auto-retrain agt_123 --enabled

  $ chatbase agents auto-retrain --enabled
```

_See code: [src/commands/agents/auto-retrain.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/agents/auto-retrain.ts)_

## `chatbase agents clone AGENTID`

Clone an agent, including all its sources (excluding Notion)

```
USAGE
  $ chatbase agents clone AGENTID [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]

ARGUMENTS
  AGENTID  Agent ID to clone

FLAGS
  -q, --quiet     Suppress non-essential output
      --no-color  Disable colored output
      --no-input  Never prompt; fail instead
      --verbose   Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Clone an agent, including all its sources (excluding Notion)

EXAMPLES
  $ chatbase agents clone agt_123
```

_See code: [src/commands/agents/clone.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/agents/clone.ts)_

## `chatbase agents create`

Create a new agent

```
USAGE
  $ chatbase agents create [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [-f <value>...] [--name
    <value>] [--instructions <value>] [--model <value>] [--data <value>]

FLAGS
  -f, --field=<value>...      Set a body field: -f key=value (repeatable)
  -q, --quiet                 Suppress non-essential output
      --data=<value>          JSON body (@file, @-, or inline). Fields: name, instructions, model, visibility, temp
      --instructions=<value>  System instructions
      --model=<value>         Model ID
      --name=<value>          Agent name
      --no-color              Disable colored output
      --no-input              Never prompt; fail instead
      --verbose               Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Create a new agent

EXAMPLES
  $ chatbase agents create --name "Support Bot" --instructions "Be helpful"

  $ chatbase agents create --data @agent.json
```

_See code: [src/commands/agents/create.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/agents/create.ts)_

## `chatbase agents delete AGENTID`

Permanently delete an agent (cannot be undone)

```
USAGE
  $ chatbase agents delete AGENTID [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--confirm <value>]

ARGUMENTS
  AGENTID  Agent ID

FLAGS
  -q, --quiet            Suppress non-essential output
      --confirm=<value>  Confirm by repeating the agent ID (required in scripts and CI)
      --no-color         Disable colored output
      --no-input         Never prompt; fail instead
      --verbose          Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Permanently delete an agent (cannot be undone)

EXAMPLES
  $ chatbase agents delete agt_123 --confirm agt_123
```

_See code: [src/commands/agents/delete.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/agents/delete.ts)_

## `chatbase agents get [AGENTID]`

Show one agent

```
USAGE
  $ chatbase agents get [AGENTID] [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>]

ARGUMENTS
  [AGENTID]  Agent ID

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Show one agent

EXAMPLES
  $ chatbase agents get agt_123

  $ chatbase agents get
```

_See code: [src/commands/agents/get.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/agents/get.ts)_

## `chatbase agents list`

List all agents in the workspace

```
USAGE
  $ chatbase agents list [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--limit <value>]
    [--cursor <value>] [--all]

FLAGS
  -q, --quiet           Suppress non-essential output
      --all             Fetch every page
      --cursor=<value>  Pagination cursor from a previous page
      --limit=<value>   Maximum items per page
      --no-color        Disable colored output
      --no-input        Never prompt; fail instead
      --verbose         Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  List all agents in the workspace

EXAMPLES
  $ chatbase agents list

  $ chatbase agents list --json
```

_See code: [src/commands/agents/list.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/agents/list.ts)_

## `chatbase agents styles [AGENTID]`

Update visual styles for an agent

```
USAGE
  $ chatbase agents styles [AGENTID] --data <value> [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]
    [--agent-name <value> | -a <value>] [-f <value>...]

ARGUMENTS
  [AGENTID]  Agent ID

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -f, --field=<value>...    Set a body field: -f key=value (repeatable)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --data=<value>        (required) JSON body (@file, @-, or inline). See API docs for style properties
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Update visual styles for an agent

EXAMPLES
  $ chatbase agents styles agt_123 --data '{"chat":{"theme":"dark"}}'

  $ chatbase agents styles --data @styles.json
```

_See code: [src/commands/agents/styles.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/agents/styles.ts)_

## `chatbase agents train [AGENTID]`

Queue a training job for an agent

```
USAGE
  $ chatbase agents train [AGENTID] [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>]

ARGUMENTS
  [AGENTID]  Agent ID to train (defaults to the configured agent, like other commands)

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Queue a training job for an agent

EXAMPLES
  $ chatbase agents train agt_123

  $ chatbase agents train
```

_See code: [src/commands/agents/train.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/agents/train.ts)_

## `chatbase agents update [AGENTID]`

Update an existing agent

```
USAGE
  $ chatbase agents update [AGENTID] [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>] [-f <value>...] [--name <value>] [--instructions <value>] [--model <value>] [--data <value>]

ARGUMENTS
  [AGENTID]  Agent ID

FLAGS
  -a, --agent=<value>         Agent ID (or set CHATBASE_AGENT_ID)
  -f, --field=<value>...      Set a body field: -f key=value (repeatable)
  -q, --quiet                 Suppress non-essential output
      --agent-name=<value>    Agent display name (looked up to an ID)
      --data=<value>          JSON body (@file, @-, or inline). Fields: name, instructions, model, visibility, temp
      --instructions=<value>  System instructions
      --model=<value>         Model ID
      --name=<value>          Agent name
      --no-color              Disable colored output
      --no-input              Never prompt; fail instead
      --verbose               Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Update an existing agent

EXAMPLES
  $ chatbase agents update agt_123 --name "New Name"

  $ chatbase agents update --name "New Name"

  $ chatbase agents update agt_123 --data @agent.json
```

_See code: [src/commands/agents/update.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/agents/update.ts)_

## `chatbase api METHOD PATH`

Call the Chatbase API directly — an escape hatch for endpoints without a dedicated command

```
USAGE
  $ chatbase api METHOD PATH [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [-f
    <value>...] [--query <value>...] [--body <value>]

ARGUMENTS
  METHOD  (GET|POST|PUT|PATCH|DELETE) HTTP method
  PATH    API path relative to /api/v2, e.g. /agents

FLAGS
  -f, --field=<value>...  Set a body field: -f key=value (repeatable)
  -q, --quiet             Suppress non-essential output
      --body=<value>      JSON request body (@file, @-, or inline JSON)
      --no-color          Disable colored output
      --no-input          Never prompt; fail instead
      --query=<value>...  Query param k=v (repeatable)
      --verbose           Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Call the Chatbase API directly — an escape hatch for endpoints without a dedicated command

EXAMPLES
  $ chatbase api GET /agents

  $ chatbase api GET /agents --field limit=5

  $ chatbase api POST /agents --body '{"name":"Support Bot"}'

  $ chatbase api PATCH /agents/agt_123 --body @patch.json
```

_See code: [src/commands/api.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/api.ts)_

## `chatbase auth login`

Authenticate with Chatbase — paste an API key or log in via browser

```
USAGE
  $ chatbase auth login [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--with-token] [--browser]

FLAGS
  -q, --quiet       Suppress non-essential output
      --browser     Log in via browser — approve a code at chatbase.co/activate
      --no-color    Disable colored output
      --no-input    Never prompt; fail instead
      --verbose     Verbose diagnostics
      --with-token  Read the API key from stdin

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Authenticate with Chatbase — paste an API key or log in via browser

EXAMPLES
  $ chatbase auth login

  $ chatbase auth login --browser

  cat key.txt | chatbase auth login --with-token
```

_See code: [src/commands/auth/login.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/auth/login.ts)_

## `chatbase auth logout`

Remove the stored API key (revokes CLI-paired keys server-side)

```
USAGE
  $ chatbase auth logout [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]

FLAGS
  -q, --quiet     Suppress non-essential output
      --no-color  Disable colored output
      --no-input  Never prompt; fail instead
      --verbose   Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Remove the stored API key (revokes CLI-paired keys server-side)

EXAMPLES
  $ chatbase auth logout
```

_See code: [src/commands/auth/logout.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/auth/logout.ts)_

## `chatbase auth status`

Show the active credential and where it comes from

```
USAGE
  $ chatbase auth status [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]

FLAGS
  -q, --quiet     Suppress non-essential output
      --no-color  Disable colored output
      --no-input  Never prompt; fail instead
      --verbose   Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Show the active credential and where it comes from

EXAMPLES
  $ chatbase auth status
```

_See code: [src/commands/auth/status.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/auth/status.ts)_

## `chatbase chat`

Send a message to an agent and print its response

```
USAGE
  $ chatbase chat [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>] [-m <value>] [--resume --conversation <value>] [--no-stream]

FLAGS
  -a, --agent=<value>         Agent ID (or set CHATBASE_AGENT_ID)
  -m, --message=<value>       Message to send (else read from piped stdin, else an interactive REPL)
  -q, --quiet                 Suppress non-essential output
      --agent-name=<value>    Agent display name (looked up to an ID)
      --conversation=<value>  Continue an existing conversation
      --no-color              Disable colored output
      --no-input              Never prompt; fail instead
      --no-stream             Wait for the complete response instead of streaming tokens
      --resume                Replay the last few messages when continuing a conversation
      --verbose               Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Send a message to an agent and print its response

EXAMPLES
  $ chatbase chat -a agt_123 -m "How do I reset my password?"

  echo "summarize our refund policy" | chatbase chat -a agt_123

  $ chatbase chat -a agt_123 -m "and then?" --conversation conv_123

  $ chatbase chat -a agt_123 -m "hi" --no-stream

  $ chatbase chat -a agt_123 -m "hi" --json
```

_See code: [src/commands/chat/index.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/chat/index.ts)_

## `chatbase chat retry`

Retry generating an assistant response (discards that message and everything after it in the conversation)

```
USAGE
  $ chatbase chat retry --conversation <value> --message-id <value> [--json] [--plain] [-q] [--verbose]
    [--no-input] [--no-color] [--agent-name <value> | -a <value>] [--no-stream]

FLAGS
  -a, --agent=<value>         Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet                 Suppress non-essential output
      --agent-name=<value>    Agent display name (looked up to an ID)
      --conversation=<value>  (required) The conversation ID to retry in
      --message-id=<value>    (required) The message ID to retry from
      --no-color              Disable colored output
      --no-input              Never prompt; fail instead
      --no-stream             Wait for the complete response instead of streaming tokens
      --verbose               Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Retry generating an assistant response (discards that message and everything after it in the conversation)

EXAMPLES
  $ chatbase chat retry --conversation c_123 -a agt_123 --message-id msg_456

  $ chatbase chat retry --conversation c_123 -a agt_123 --message-id msg_456 --no-stream
```

_See code: [src/commands/chat/retry.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/chat/retry.ts)_

## `chatbase config get KEY`

Print a resolved CLI configuration value and where it comes from

```
USAGE
  $ chatbase config get KEY [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]

ARGUMENTS
  KEY  agent | timeout

FLAGS
  -q, --quiet     Suppress non-essential output
      --no-color  Disable colored output
      --no-input  Never prompt; fail instead
      --verbose   Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Print a resolved CLI configuration value and where it comes from

EXAMPLES
  $ chatbase config get agent

  $ chatbase config get timeout
```

_See code: [src/commands/config/get.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/config/get.ts)_

## `chatbase config list`

List every resolved CLI configuration value and its source

```
USAGE
  $ chatbase config list [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]

FLAGS
  -q, --quiet     Suppress non-essential output
      --no-color  Disable colored output
      --no-input  Never prompt; fail instead
      --verbose   Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  List every resolved CLI configuration value and its source

EXAMPLES
  $ chatbase config list
```

_See code: [src/commands/config/list.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/config/list.ts)_

## `chatbase config set KEY [VALUE]`

Set a CLI configuration value

```
USAGE
  $ chatbase config set KEY [VALUE] [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]

ARGUMENTS
  KEY      agent | timeout
  [VALUE]  New value (omit for agent to pick interactively)

FLAGS
  -q, --quiet     Suppress non-essential output
      --no-color  Disable colored output
      --no-input  Never prompt; fail instead
      --verbose   Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Set a CLI configuration value

EXAMPLES
  $ chatbase config set agent agt_123

  $ chatbase config set agent

  $ chatbase config set timeout 60000
```

_See code: [src/commands/config/set.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/config/set.ts)_

## `chatbase conversations export`

Export conversations from every source, with full message history

```
USAGE
  $ chatbase conversations export [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>] [--cursor <value>] [--limit <value>] [--all] [-o <value>]

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -o, --output=<value>      Write export JSON to a file instead of stdout
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --all                 Fetch every page
      --cursor=<value>      Opaque cursor from a previous response
      --limit=<value>       Items per page (1-20, default 20)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Export conversations from every source, with full message history

  Export conversations with full message history, newest first.

  This is the only endpoint that returns conversations from every source — the chat bubble and external integrations
  (Slack, WhatsApp, Instagram, Messenger, and the like) as well as API-created ones. Prefer it over `conversations list`
  whenever you need real traffic rather than just programmatically created conversations. Each item embeds its own
  `messages` array, so no follow-up `conversations get` or `messages list` call is needed (and neither works for
  bubble/integration conversations).

EXAMPLES
  $ chatbase conversations export -a agt_123

  $ chatbase conversations export -a agt_123 --all -o export.json
```

_See code: [src/commands/conversations/export.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/conversations/export.ts)_

## `chatbase conversations get [CONVERSATIONID]`

Show one conversation

```
USAGE
  $ chatbase conversations get [CONVERSATIONID] [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]
    [--agent-name <value> | -a <value>] [--conversation <value>]

ARGUMENTS
  [CONVERSATIONID]  Conversation ID (alternative to --conversation)

FLAGS
  -a, --agent=<value>         Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet                 Suppress non-essential output
      --agent-name=<value>    Agent display name (looked up to an ID)
      --conversation=<value>  Conversation ID
      --no-color              Disable colored output
      --no-input              Never prompt; fail instead
      --verbose               Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Show one conversation

EXAMPLES
  $ chatbase conversations get conv_123 -a agt_123

  $ chatbase conversations get --conversation conv_123 -a agt_123
```

_See code: [src/commands/conversations/get.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/conversations/get.ts)_

## `chatbase conversations list`

List an agent’s API-created conversations

```
USAGE
  $ chatbase conversations list [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>] [--limit <value>] [--cursor <value>] [--all] [--user <value>]

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --all                 Fetch every page
      --cursor=<value>      Pagination cursor from a previous page
      --limit=<value>       Maximum items per page
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --user=<value>        List conversations for a specific user (uses GET /users/{userId}/conversations)
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  List an agent’s API-created conversations

  List conversations for an agent, newest first.

  Scope: the API v2 list endpoint returns only conversations created programmatically through the API. Conversations
  from the chat bubble and external integrations (Slack, WhatsApp, Instagram, Messenger, and the like) are not
  accessible here and are not counted in `total`. Use `chatbase conversations export` to read conversations from every
  source — it also embeds full message history, which `conversations get` and `messages list` cannot retrieve for those
  conversations.

EXAMPLES
  $ chatbase conversations list -a agt_123

  $ chatbase conversations list -a agt_123 --user usr_456

  $ chatbase conversations list -a agt_123 --all --json
```

_See code: [src/commands/conversations/list.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/conversations/list.ts)_

## `chatbase conversations tool-result [CONVERSATIONID]`

Submit a client-side tool result to a chat turn

```
USAGE
  $ chatbase conversations tool-result [CONVERSATIONID] --tool-call-id <value> [--json] [--plain] [-q] [--verbose] [--no-input]
    [--no-color] [--agent-name <value> | -a <value>] [--conversation <value>] [--output <value>]

ARGUMENTS
  [CONVERSATIONID]  Conversation ID (alternative to --conversation)

FLAGS
  -a, --agent=<value>         Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet                 Suppress non-essential output
      --agent-name=<value>    Agent display name (looked up to an ID)
      --conversation=<value>  Conversation ID
      --no-color              Disable colored output
      --no-input              Never prompt; fail instead
      --output=<value>        Result of executing the tool (inline JSON, @file, or @-); a value that is not valid JSON
                              is sent as a plain string
      --tool-call-id=<value>  (required) The toolCallId from the tool-call part in the chat response
      --verbose               Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Submit a client-side tool result to a chat turn

  Submit the result of a client-side tool call so the paused chat turn can continue. The tool call ID comes from the
  tool-call part of the chat response that requested the execution.

EXAMPLES
  $ chatbase conversations tool-result conv_123 --tool-call-id tc_1 --output '{"temperature": 72}' -a agt_123

  $ chatbase conversations tool-result conv_123 --tool-call-id tc_1 --output @result.json -a agt_123

  $ chatbase conversations tool-result conv_123 --tool-call-id tc_1 -a agt_123
```

_See code: [src/commands/conversations/tool-result.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/conversations/tool-result.ts)_

## `chatbase health`

Check that the Chatbase API is reachable

```
USAGE
  $ chatbase health [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]

FLAGS
  -q, --quiet     Suppress non-essential output
      --no-color  Disable colored output
      --no-input  Never prompt; fail instead
      --verbose   Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Check that the Chatbase API is reachable

EXAMPLES
  $ chatbase health

  $ chatbase health --json
```

_See code: [src/commands/health.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/health.ts)_

## `chatbase help [COMMAND]`

Display help for chatbase.

```
USAGE
  $ chatbase help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for chatbase.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.2.58/src/commands/help.ts)_

## `chatbase helpdesk statuses`

List ticket statuses for an agent

```
USAGE
  $ chatbase helpdesk statuses [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>]

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  List ticket statuses for an agent

EXAMPLES
  $ chatbase helpdesk statuses -a agt_123
```

_See code: [src/commands/helpdesk/statuses.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/helpdesk/statuses.ts)_

## `chatbase helpdesk teams`

List helpdesk teams for an agent

```
USAGE
  $ chatbase helpdesk teams [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>]

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  List helpdesk teams for an agent

EXAMPLES
  $ chatbase helpdesk teams -a agt_123
```

_See code: [src/commands/helpdesk/teams.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/helpdesk/teams.ts)_

## `chatbase messages feedback [MESSAGEID]`

Set or clear user feedback on an assistant message

```
USAGE
  $ chatbase messages feedback [MESSAGEID] --conversation <value> --rating positive|negative|clear [--json] [--plain]
    [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a <value>] [--message <value>]

ARGUMENTS
  [MESSAGEID]  Message ID (alternative to --message)

FLAGS
  -a, --agent=<value>         Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet                 Suppress non-essential output
      --agent-name=<value>    Agent display name (looked up to an ID)
      --conversation=<value>  (required) Conversation ID
      --message=<value>       Message ID
      --no-color              Disable colored output
      --no-input              Never prompt; fail instead
      --rating=<option>       (required) Feedback value ("clear" removes existing feedback)
                              <options: positive|negative|clear>
      --verbose               Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Set or clear user feedback on an assistant message

EXAMPLES
  $ chatbase messages feedback msg_1 --conversation conv_123 --rating positive -a agt_123

  $ chatbase messages feedback --conversation conv_123 --message msg_1 --rating clear -a agt_123
```

_See code: [src/commands/messages/feedback.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/messages/feedback.ts)_

## `chatbase messages list`

List messages in a conversation

```
USAGE
  $ chatbase messages list --conversation <value> [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]
    [--agent-name <value> | -a <value>] [--limit <value>] [--cursor <value>] [--all]

FLAGS
  -a, --agent=<value>         Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet                 Suppress non-essential output
      --agent-name=<value>    Agent display name (looked up to an ID)
      --all                   Fetch every page
      --conversation=<value>  (required) Conversation ID
      --cursor=<value>        Pagination cursor from a previous page
      --limit=<value>         Maximum items per page
      --no-color              Disable colored output
      --no-input              Never prompt; fail instead
      --verbose               Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  List messages in a conversation

EXAMPLES
  $ chatbase messages list --conversation conv_123 -a agt_123

  $ chatbase messages list --conversation conv_123 -a agt_123 --all --json
```

_See code: [src/commands/messages/list.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/messages/list.ts)_

## `chatbase sources create`

Create a source: text/qna/link (JSON) or a file upload

```
USAGE
  $ chatbase sources create [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>] [-f <value>...] [--type text|qna|link | --file <value>] [--name <value>] [--content <value>] [--url
    <value>] [--link-type individual|sitemap|crawl] [--data <value>]

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -f, --field=<value>...    Set a body field: -f key=value (repeatable)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --content=<value>     Text content for --type text (@file, @-, or inline)
      --data=<value>        JSON body (@file, @-, or inline); per-type flags override matching keys
      --file=<value>        Path to a file to upload as a source (mutually exclusive with --type)
      --link-type=<option>  Link crawl mode for --type link
                            <options: individual|sitemap|crawl>
      --name=<value>        Source name (--type text/qna, or a file upload)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --type=<option>       JSON source type (mutually exclusive with --file)
                            <options: text|qna|link>
      --url=<value>         URL for --type link
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Create a source: text/qna/link (JSON) or a file upload

EXAMPLES
  $ chatbase sources create --type text --name Guide --content "hello" -a agt_123

  $ chatbase sources create --type link --url https://example.com --link-type crawl -a agt_123

  $ chatbase sources create --type qna --data '{"questions":["Q1"],"answer":"A1"}' -a agt_123

  $ chatbase sources create --file ./guide.pdf -a agt_123
```

_See code: [src/commands/sources/create.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/sources/create.ts)_

## `chatbase sources delete SOURCEID`

Delete a source (restorable via restore command)

```
USAGE
  $ chatbase sources delete SOURCEID [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>]

ARGUMENTS
  SOURCEID  Source ID

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Delete a source (restorable via restore command)

EXAMPLES
  $ chatbase sources delete src_1 -a agt_1
```

_See code: [src/commands/sources/delete.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/sources/delete.ts)_

## `chatbase sources get SOURCEID`

Show one source

```
USAGE
  $ chatbase sources get SOURCEID [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>]

ARGUMENTS
  SOURCEID  Source ID

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Show one source

EXAMPLES
  $ chatbase sources get src_123 -a agt_123
```

_See code: [src/commands/sources/get.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/sources/get.ts)_

## `chatbase sources list`

List sources for an agent

```
USAGE
  $ chatbase sources list [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>] [--limit <value>] [--cursor <value>] [--all] [--type <value>] [--name <value>]

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --all                 Fetch every page
      --cursor=<value>      Pagination cursor from a previous page
      --limit=<value>       Maximum items per page
      --name=<value>        Filter by source name
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --type=<value>        Filter by source type
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  List sources for an agent

EXAMPLES
  $ chatbase sources list -a agt_123

  $ chatbase sources list -a agt_123 --all --json
```

_See code: [src/commands/sources/list.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/sources/list.ts)_

## `chatbase sources restore SOURCEID`

Restore a deleted source

```
USAGE
  $ chatbase sources restore SOURCEID [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>]

ARGUMENTS
  SOURCEID  Source ID

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Restore a deleted source

EXAMPLES
  $ chatbase sources restore src_1 -a agt_1
```

_See code: [src/commands/sources/restore.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/sources/restore.ts)_

## `chatbase sources summary`

Show aggregated source counts and sizes for an agent

```
USAGE
  $ chatbase sources summary [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>]

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Show aggregated source counts and sizes for an agent

EXAMPLES
  $ chatbase sources summary -a agt_123
```

_See code: [src/commands/sources/summary.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/sources/summary.ts)_

## `chatbase sources update SOURCEID`

Update an existing source (text, qna, link, or file)

```
USAGE
  $ chatbase sources update SOURCEID [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>] [-f <value>...] [--data <value> | --file <value>]

ARGUMENTS
  SOURCEID  Source ID

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -f, --field=<value>...    Set a body field: -f key=value (repeatable)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --data=<value>        JSON body for text/qna/link sources (@file, @-, or inline)
      --file=<value>        Path to a file to upload as a replacement (mutually exclusive with --data)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Update an existing source (text, qna, link, or file)

EXAMPLES
  $ chatbase sources update src_1 --data '{"type":"text","content":"new"}' -a agt_1

  $ chatbase sources update src_1 --file ./updated.pdf -a agt_1
```

_See code: [src/commands/sources/update.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/sources/update.ts)_

## `chatbase tickets create`

Create a helpdesk ticket

```
USAGE
  $ chatbase tickets create [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>] [-f <value>...] [--subject <value>] [--customer-name <value> --customer-email <value>] [--data <value>]

FLAGS
  -a, --agent=<value>           Agent ID (or set CHATBASE_AGENT_ID)
  -f, --field=<value>...        Set a body field: -f key=value (repeatable)
  -q, --quiet                   Suppress non-essential output
      --agent-name=<value>      Agent display name (looked up to an ID)
      --customer-email=<value>  Customer email — builds the required customer object (alternative to customer in --data)
      --customer-name=<value>   Customer display name, used only when the email creates a new customer record
      --data=<value>            JSON body (@file, @-, or inline). Fields: subject, description, customer, statusId,
                                statusCategory, assigneeId, assigneeEmail, teamId
      --no-color                Disable colored output
      --no-input                Never prompt; fail instead
      --subject=<value>         Ticket subject
      --verbose                 Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Create a helpdesk ticket

EXAMPLES
  $ chatbase tickets create --subject "Export failing" -f description="Customer cannot export." --customer-email jane@example.com -a agt_123

  $ chatbase tickets create --subject "Export failing" --data '{"description":"Customer cannot export.","customer":{"email":"jane@example.com"}}' -a agt_123
```

_See code: [src/commands/tickets/create.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/tickets/create.ts)_

## `chatbase tickets get TICKETNUMBER`

Show one helpdesk ticket

```
USAGE
  $ chatbase tickets get TICKETNUMBER [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>]

ARGUMENTS
  TICKETNUMBER  Ticket number

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Show one helpdesk ticket

EXAMPLES
  $ chatbase tickets get 42 -a agt_123
```

_See code: [src/commands/tickets/get.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/tickets/get.ts)_

## `chatbase tickets list`

List helpdesk tickets for an agent

```
USAGE
  $ chatbase tickets list [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>] [--limit <value>] [--cursor <value>] [--all] [--status <value>] [--channel <value>] [--assignee-id <value>]
    [--team-id <value>] [--created-after <value>] [--created-before <value>] [--sort-by
    createdAt|updatedAt|lastMessageAt] [--order asc|desc] [--include-total]

FLAGS
  -a, --agent=<value>           Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet                   Suppress non-essential output
      --agent-name=<value>      Agent display name (looked up to an ID)
      --all                     Fetch every page
      --assignee-id=<value>     Filter by assignee UUID, or "none" for unassigned
      --channel=<value>         Filter by channel (comma-separated, e.g. email,api)
      --created-after=<value>   Only tickets created after this ISO 8601 date
      --created-before=<value>  Only tickets created before this ISO 8601 date
      --cursor=<value>          Pagination cursor from a previous page
      --include-total           Include pagination.total in the response
      --limit=<value>           Maximum items per page
      --no-color                Disable colored output
      --no-input                Never prompt; fail instead
      --order=<option>          Sort direction
                                <options: asc|desc>
      --sort-by=<option>        Sort field
                                <options: createdAt|updatedAt|lastMessageAt>
      --status=<value>          Filter by status (comma-separated): new, on_you, on_customer, on_hold, closed, cancelled
      --team-id=<value>         Filter by team UUID, or "none" for no team
      --verbose                 Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  List helpdesk tickets for an agent

EXAMPLES
  $ chatbase tickets list -a agt_123

  $ chatbase tickets list -a agt_123 --status new,on_you

  $ chatbase tickets list -a agt_123 --all --json
```

_See code: [src/commands/tickets/list.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/tickets/list.ts)_

## `chatbase tickets messages [TICKETNUMBER]`

List a ticket's message thread

```
USAGE
  $ chatbase tickets messages [TICKETNUMBER] [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]
    [--agent-name <value> | -a <value>] [--limit <value>] [--cursor <value>] [--all] [--ticket <value>] [--types
    <value>] [--order asc|desc]

ARGUMENTS
  [TICKETNUMBER]  Ticket number (alternative to --ticket)

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --all                 Fetch every page
      --cursor=<value>      Pagination cursor from a previous page
      --limit=<value>       Maximum items per page
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --order=<option>      Sort direction
                            <options: asc|desc>
      --ticket=<value>      Ticket number
      --types=<value>       Message types to include (comma-separated): reply, note, event (default: reply,note)
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  List a ticket's message thread

EXAMPLES
  $ chatbase tickets messages 42 -a agt_123

  $ chatbase tickets messages 42 -a agt_123 --all --json
```

_See code: [src/commands/tickets/messages.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/tickets/messages.ts)_

## `chatbase tickets reply [TICKETNUMBER]`

Post an agent reply to a ticket's message thread

```
USAGE
  $ chatbase tickets reply [TICKETNUMBER] -m <value> [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]
    [--agent-name <value> | -a <value>] [--ticket <value>] [--author-id <value>] [--author-email <value>]

ARGUMENTS
  [TICKETNUMBER]  Ticket number (alternative to --ticket)

FLAGS
  -a, --agent=<value>         Agent ID (or set CHATBASE_AGENT_ID)
  -m, --message=<value>       (required) Reply body as GitHub-flavored Markdown
  -q, --quiet                 Suppress non-essential output
      --agent-name=<value>    Agent display name (looked up to an ID)
      --author-email=<value>  Email of the team member the reply is attributed to (exactly one of
                              --author-id/--author-email)
      --author-id=<value>     Platform user id of the team member the reply is attributed to (exactly one of
                              --author-id/--author-email)
      --no-color              Disable colored output
      --no-input              Never prompt; fail instead
      --ticket=<value>        Ticket number
      --verbose               Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Post an agent reply to a ticket's message thread

EXAMPLES
  $ chatbase tickets reply 42 -m "On it" --author-email sam@example.com -a agt_123
```

_See code: [src/commands/tickets/reply.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/tickets/reply.ts)_

## `chatbase tickets search QUERY`

Search tickets by message content

```
USAGE
  $ chatbase tickets search QUERY [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>] [--limit <value>]

ARGUMENTS
  QUERY  Free-text search terms (matched against ticket messages)

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --limit=<value>       Number of results (1–50, default 20)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Search tickets by message content

EXAMPLES
  $ chatbase tickets search "refund not received" -a agt_123

  $ chatbase tickets search "refund" -a agt_123 --limit 10 --json
```

_See code: [src/commands/tickets/search.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/tickets/search.ts)_

## `chatbase tickets update TICKETNUMBER`

Update a ticket's status, assignee, and/or team

```
USAGE
  $ chatbase tickets update TICKETNUMBER [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name
    <value> | -a <value>] [-f <value>...] [--data <value>]

ARGUMENTS
  TICKETNUMBER  Ticket number

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -f, --field=<value>...    Set a body field: -f key=value (repeatable)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --data=<value>        JSON body (@file, @-, or inline). Fields: statusId, statusCategory, assigneeId,
                            assigneeEmail, teamId
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Update a ticket's status, assignee, and/or team

EXAMPLES
  $ chatbase tickets update 42 --data '{"statusCategory":"closed"}' -a agt_123
```

_See code: [src/commands/tickets/update.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/tickets/update.ts)_

## `chatbase whatsapp send-template TEMPLATE`

Send an approved WhatsApp template message

```
USAGE
  $ chatbase whatsapp send-template TEMPLATE --to <value> [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color]
    [--agent-name <value> | -a <value>] [--from <value>] [--language <value>] [--variables <value>]

ARGUMENTS
  TEMPLATE  Name of the approved template

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --from=<value>        Which connected WhatsApp number to send from — optional when the agent has exactly one
      --language=<value>    Template language code (e.g. en_US) — optional when the template exists in a single language
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --to=<value>          (required) Recipient phone number in international format (digits with country code)
      --variables=<value>   Template variable values as JSON grouped by component (@file, @-, or inline), e.g.
                            '{"body":{"1":"Jane"}}'
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  Send an approved WhatsApp template message

  Send an approved WhatsApp template to a phone number from one of the agent’s connected numbers. No user ID is needed —
  a Chatbase user is resolved or created from the recipient number, and replies flow through the agent’s regular
  WhatsApp pipeline. Use `whatsapp templates` to see available templates and the variables each expects.

EXAMPLES
  $ chatbase whatsapp send-template order_update --to 14155552671 -a agt_123

  $ chatbase whatsapp send-template order_update --to 14155552671 --language en_US --variables '{"header":{"1":"#1042"},"body":{"1":"Jane","2":"Friday"}}' -a agt_123
```

_See code: [src/commands/whatsapp/send-template.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/whatsapp/send-template.ts)_

## `chatbase whatsapp templates`

List approved WhatsApp templates for an agent

```
USAGE
  $ chatbase whatsapp templates [--json] [--plain] [-q] [--verbose] [--no-input] [--no-color] [--agent-name <value> | -a
    <value>]

FLAGS
  -a, --agent=<value>       Agent ID (or set CHATBASE_AGENT_ID)
  -q, --quiet               Suppress non-essential output
      --agent-name=<value>  Agent display name (looked up to an ID)
      --no-color            Disable colored output
      --no-input            Never prompt; fail instead
      --verbose             Verbose diagnostics

OUTPUT FLAGS
  --json   Output raw API JSON
  --plain  Tab-separated output for scripts

DESCRIPTION
  List approved WhatsApp templates for an agent

  List the approved WhatsApp templates available to the agent, across all of its connected WhatsApp Business Accounts. A
  template can only be sent from a number on its own Business Account — pick a sender whose WABA matches the template’s
  WABA column.

EXAMPLES
  $ chatbase whatsapp templates -a agt_123

  $ chatbase whatsapp templates -a agt_123 --json
```

_See code: [src/commands/whatsapp/templates.ts](https://github.com/Chatbase-co/chatbase-cli/blob/v0.1.0/src/commands/whatsapp/templates.ts)_
<!-- commandsstop -->
