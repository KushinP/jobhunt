/**
 * The `agents` package dynamically imports the Vercel AI SDK (`ai`) inside its MCP *client*
 * helpers (getAITools). This server only uses the McpAgent server side, so rather than
 * bundling that whole dependency we alias `ai` to this stub. It throws loudly if anything
 * ever actually reaches it, so a future use surfaces instead of silently misbehaving.
 */
export function jsonSchema(): never {
  throw new Error(
    'The `ai` package is stubbed in jobhunt-mcp. Something called the MCP client helpers '
    + '(getAITools). Install `ai` and drop the alias in mcp/wrangler.jsonc if that is intended.',
  );
}

export default { jsonSchema };
