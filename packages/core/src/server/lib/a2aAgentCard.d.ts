import type { A2AAgentCard } from '../models/a2aAgentCardInfo';
/**
 * Fetch an A2A agent card from a URL
 * Supports both direct URLs and base URLs (will append /.well-known/agent-card.json)
 */
export declare function fetchA2AAgentCard(cardUrl: string): Promise<A2AAgentCard | null>;
//# sourceMappingURL=a2aAgentCard.d.ts.map