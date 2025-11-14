import type { A2AAgentCard } from '../models/a2aAgentCardInfo';

/**
 * Fetch agent-card.json from a URL
 * Supports both direct URLs and base URLs (will append /.well-known/agent-card.json)
 */
export async function fetchA2AAgentCard(cardUrl: string): Promise<A2AAgentCard | null> {
  try {
    // Ensure URL is absolute or resolve relative URLs
    let url = cardUrl.startsWith('http')
      ? cardUrl
      : new URL(cardUrl, typeof window !== 'undefined' ? window.location.origin : '').toString();

    // If URL doesn't end with agent-card.json or .well-known, append the standard path
    if (!url.includes('agent-card.json')) {
      // Remove trailing slash and append the standard path
      url = `${url.replace(/\/$/, '')}/.well-known/agent-card.json`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch agent card: ${response.status} ${response.statusText}`);
    }

    const card: A2AAgentCard = await response.json();
    return card;
  } catch (error) {
    console.error('Error fetching agent card:', error);
    return null;
  }
}


