import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

async function queryGraphQL(query: string, variables: any = {}) {
  const base = (process.env.AGENTIC_TRUST_DISCOVERY_URL || '').replace(/\/+$/, '');
  const GRAPHQL_URL = base
    ? (base.endsWith('/graphql') ? base : `${base}/graphql`)
    : '';
  
  try {
    if (!GRAPHQL_URL) {
      console.warn("No AGENTIC_TRUST_DISCOVERY_URL configured");
      return null;
    }

    // Get secret access code for server-to-server authentication
    const secretAccessCode = process.env.AGENTIC_TRUST_DISCOVERY_API_KEY;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (secretAccessCode) {
      headers['Authorization'] = `Bearer ${secretAccessCode}`;
    } else {
      console.warn("⚠️ GRAPHQL_SECRET_ACCESS_CODE not configured! Stats requests may fail.");
    }

    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ query, variables }),
      cache: 'no-store', // Disable Next.js fetch caching
    });

    if (!res.ok) {
      console.error(`GraphQL request failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return null;
    }

    return data.data;
  } catch (error: any) {
    console.error('GraphQL fetch error:', error?.message || error);
    return null;
  }
}

// Simple in-memory cache (per server instance) to reduce load
let cachedStats: any | null = null;
let cachedAt: number | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function GET() {
  console.log('[Stats API] GET request received');
  try {
    const now = Date.now();
    if (cachedStats && cachedAt && now - cachedAt < CACHE_TTL_MS) {
      const age = Math.round((now - cachedAt) / 1000);
      console.log('[Stats API] returning cached stats (age:', age, 'seconds)');
      console.log('[Stats API] Cached totalAgents:', cachedStats?.summary?.totalAgents || 0);
      console.log('[Stats API] Cached totalChains:', cachedStats?.summary?.totalChains || 0);
      
      // Validate cached data - if empty, clear cache and fetch fresh
      const hasCachedData = cachedStats?.summary?.totalAgents > 0;
      
      if (!hasCachedData) {
        console.warn('[Stats API] Cached data is empty, clearing cache and fetching fresh');
        cachedStats = null;
        cachedAt = null;
        // Fall through to fetch fresh data
      } else {
        return NextResponse.json(cachedStats);
      }
    }

    // Get all agents grouped by chain, ordered by agentId DESC to get highest first
    const query = `
      query GetStats {
        agents(limit: 10000, offset: 0, orderBy: "agentId", orderDirection: "desc") {
          chainId
          agentId
          agentName
          description
          image
          tokenUri
          ensEndpoint
          createdAtTime
        }
      }
    `;

    console.log('[Stats API] Cache miss or expired, fetching stats from GraphQL');
    const data = await queryGraphQL(query);

    if (!data || !data.agents) {
      // Return empty stats if GraphQL is not available, but don't cache
      console.warn('Stats API: No data returned from GraphQL');
      // Don't cache empty data - return previous cache if available, otherwise empty
      if (cachedStats) {
        console.log('[Stats API] GraphQL failed, returning previous cached stats');
        return NextResponse.json(cachedStats);
      }
      return NextResponse.json({
        summary: {
          totalAgents: 0,
          totalChains: 0,
          chains: []
        },
        metadata: { chains: [] },
        ens: { chains: [] },
        activity: { recent24h: [] },
        topAgents: []
      });
    }

    const agents = data.agents || [];
    const last24Hours = Math.floor(Date.now() / 1000) - 86400;

    // Group by chain
    const chainGroups: Record<number, typeof agents> = {};
    agents.forEach((agent: any) => {
      if (!chainGroups[agent.chainId]) {
        chainGroups[agent.chainId] = [];
      }
      chainGroups[agent.chainId].push(agent);
    });

    const getChainName = (chainId: number) => {
      switch (chainId) {
        case 11155111: return 'ETH Sepolia';
        case 84532: return 'Base Sepolia';
        case 11155420: return 'OP Sepolia';
        default: return `Chain ${chainId}`;
      }
    };

    // Calculate stats per chain
    const chains = Object.keys(chainGroups).map(chainIdStr => {
      const chainId = parseInt(chainIdStr);
      const chainAgents = chainGroups[chainId];
      const withMetadata = chainAgents.filter((a: any) => a.tokenUri).length;
      const withENS = chainAgents.filter((a: any) => a.ensEndpoint).length;
      const recent = chainAgents.filter((a: any) => a.createdAtTime > last24Hours).length;

      return {
        chainId,
        chainName: getChainName(chainId),
        count: chainAgents.length,
        withMetadata,
        withoutMetadata: chainAgents.length - withMetadata,
        withENS,
        withoutENS: chainAgents.length - withENS,
        recentCount: recent
      };
    });

    // Get the highest agentId from each chain
    const topAgentsByChain: Record<number, any> = {};
    const maxAgentIds: Record<number, number> = {};
    agents.forEach((agent: any) => {
      const chainId = agent.chainId;
      const agentIdNum = parseInt(agent.agentId, 10);
      
      if (!topAgentsByChain[chainId] || agentIdNum > parseInt(topAgentsByChain[chainId].agentId, 10)) {
        topAgentsByChain[chainId] = agent;
        maxAgentIds[chainId] = agentIdNum;
      }
    });
    
    // Log max agentIds for debugging
    console.log('Stats API: Max agentIds per chain:', maxAgentIds);
    console.log('Stats API: Total agents received:', agents.length);
    
    // Convert to array and sort by chainId
    const topAgents = Object.values(topAgentsByChain)
      .map((agent: any) => ({
        chainId: agent.chainId,
        chainName: getChainName(agent.chainId),
        agentId: agent.agentId,
        agentName: agent.agentName || 'Unnamed',
        ensName: agent.ensEndpoint || null
      }))
      .sort((a, b) => a.chainId - b.chainId);

    const responsePayload = {
      summary: {
        totalAgents: agents.length,
        totalChains: chains.length,
        chains: chains.map(c => ({
          chainId: c.chainId,
          chainName: c.chainName,
          agentCount: c.count
        }))
      },
      metadata: {
        chains: chains.map(c => ({
          chainId: c.chainId,
          chainName: c.chainName,
          withMetadata: c.withMetadata,
          withoutMetadata: c.withoutMetadata,
          metadataPercentage: c.count > 0 ? Math.round((c.withMetadata / c.count) * 100) : 0
        }))
      },
      ens: {
        chains: chains.map(c => ({
          chainId: c.chainId,
          chainName: c.chainName,
          withENS: c.withENS,
          withoutENS: c.withoutENS,
          ensPercentage: c.count > 0 ? Math.round((c.withENS / c.count) * 100) : 0
        }))
      },
      activity: {
        recent24h: chains.map(c => ({
          chainId: c.chainId,
          chainName: c.chainName,
          recentCount: c.recentCount
        }))
      },
      topAgents
    };

    console.log('[Stats API] Fetched stats - totalAgents:', responsePayload.summary.totalAgents);
    console.log('[Stats API] Fetched stats - totalChains:', responsePayload.summary.totalChains);
    
    // Validate stats data - only cache if we have actual data
    if (responsePayload.summary.totalAgents === 0) {
      console.warn('[Stats API] Empty stats data received (totalAgents: 0), not caching');
      // Return previous cache if available, otherwise return empty
      if (cachedStats) {
        console.log('[Stats API] Returning previous cached stats instead of empty data');
        return NextResponse.json(cachedStats);
      }
      return NextResponse.json(responsePayload);
    }
    
    cachedStats = responsePayload;
    cachedAt = now;
    console.log('[Stats API] Stats cached successfully');

    return NextResponse.json(responsePayload);
  } catch (e: any) {
    console.error('[Stats API] Error fetching stats:', e);
    // Return empty stats on error to prevent site crash, but don't cache empty data
    const emptyPayload = {
      summary: {
        totalAgents: 0,
        totalChains: 0,
        chains: []
      },
      metadata: { chains: [] },
      ens: { chains: [] },
      activity: { recent24h: [] },
      topAgents: []
    };
    // Return previous cache if available, otherwise return empty (but don't cache it)
    if (cachedStats) {
      console.log('[Stats API] Error occurred, returning previous cached stats');
      return NextResponse.json(cachedStats);
    }
    return NextResponse.json(emptyPayload);
  }
}
