# Setting up GitHub MCP for Agentic Trust

To give Cursor (and the AI) direct access to the [Agentic Trust repository](https://github.com/Agentic-Trust-Layer/agentic-trust) via the Model Context Protocol (MCP), follow these steps.

## 1. Get a GitHub Access Token

1.  Go to [GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)](https://github.com/settings/tokens).
2.  Click **Generate new token (classic)**.
3.  Give it a name (e.g., "Cursor MCP").
4.  Select the **`repo`** scope (needed to read repository contents).
5.  Generate and copy the token.

## 2. Add MCP Server in Cursor

1.  Open Cursor.
2.  Go to **Settings** (Cmd+Shift+J / Ctrl+Shift+J) > **Features** > **MCP**.
3.  Click **+ Add New MCP Server**.
4.  Fill in the details:

    -   **Type**: `stdio`
    -   **Name**: `github`
    -   **Command**: `npx`
    -   **Args**: `-y @modelcontextprotocol/server-github`
    -   **Environment Variables**:
        -   Click **+ Add**
        -   Key: `GITHUB_PERSONAL_ACCESS_TOKEN`
        -   Value: *(Paste your token from Step 1)*

5.  Click **Save** (or the checkmark).

## 3. Verification

Once the server is running (green dot), you can ask the AI questions like:

> "Search the Agentic-Trust-Layer/agentic-trust repo for 'AgenticTrustClient' usage examples."

or

> "Read the README.md from the agentic-trust repo."

