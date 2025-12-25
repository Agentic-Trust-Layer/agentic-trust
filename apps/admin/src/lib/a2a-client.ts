/**
 * A2A Client Utility
 * 
 * Sends A2A messages to ATP agent at atp.8004-agent.io
 * All D1 database interactions go through ATP agent via A2A messages
 */

function getATPAgentEndpoint(): string {
  // Server-side: use environment variable
  if (typeof process !== 'undefined' && process.env.ATP_AGENT_ENDPOINT) {
    return process.env.ATP_AGENT_ENDPOINT;
  }
  
  // Client-side: use public environment variable or default
  if (typeof window !== 'undefined') {
    const publicEndpoint = (window as any).__ATP_AGENT_ENDPOINT__;
    if (publicEndpoint) return publicEndpoint;
  }
  
  // Default to atp subdomain
  return 'https://atp.8004-agent.io/api/a2a';
}

export interface A2AMessagePayload {
  email?: string;
  first_name?: string;
  last_name?: string;
  social_account_id?: string;
  social_account_type?: string;
  eoa_address?: string; // Externally Owned Account address (0x...)
  aa_address?: string; // Smart Account address (0x...)
  agent_name?: string;
  agent_account?: string;
  ens_name?: string;
  email_domain?: string;
  chain_id?: number;
  session_package?: string; // JSON string of sessionPackage
  agent_card_json?: string | null; // JSON string of agent card config (or full agent-card.json)
  metadata?: Record<string, unknown>;
}

/**
 * Send A2A message to ATP agent
 */
export async function sendA2AMessageToATP(
  skillId: string,
  payload: A2AMessagePayload,
  metadata?: Record<string, unknown>
): Promise<{ success: boolean; messageId?: string; response?: any; error?: string }> {
  try {
    const endpoint = getATPAgentEndpoint();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillId,
        payload,
        metadata: {
          source: 'admin-app',
          timestamp: new Date().toISOString(),
          ...metadata,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    console.error('[A2A Client] Error sending message to ATP agent:', error);
    return {
      success: false,
      error: error?.message || 'Failed to send A2A message',
    };
  }
}

/**
 * Add or update account in ATP database via A2A
 */
export async function syncAccountToATP(
  address: string,
  options?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    social_account_id?: string;
    social_account_type?: string;
    aa_address?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ success: boolean; action?: 'created' | 'updated'; accountId?: number; error?: string }> {
  const result = await sendA2AMessageToATP('atp.account.addOrUpdate', {
    email: options?.email,
    first_name: options?.first_name,
    last_name: options?.last_name,
    social_account_id: options?.social_account_id,
    social_account_type: options?.social_account_type,
    eoa_address: address, // Map address to eoa_address
    aa_address: options?.aa_address,
    metadata: options?.metadata,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'Failed to sync account',
    };
  }

  const response = result.response || {};
  return {
    success: true,
    action: response.action as 'created' | 'updated',
    accountId: response.accountId,
  };
}

/**
 * Create or update agent in ATP database via A2A
 */
export async function syncAgentToATP(
  agentName: string,
  agentAccount: string,
  sessionPackage: Record<string, unknown>,
  options?: {
    ensName?: string;
    emailDomain?: string;
    chainId?: number;
  }
): Promise<{ success: boolean; action?: 'created' | 'updated'; agentId?: number; error?: string }> {
  // Convert sessionPackage object to JSON string
  const sessionPackageJson = JSON.stringify(sessionPackage);

  const result = await sendA2AMessageToATP('atp.agent.createOrUpdate', {
    agent_name: agentName,
    agent_account: agentAccount,
    ens_name: options?.ensName,
    email_domain: options?.emailDomain,
    chain_id: options?.chainId,
    session_package: sessionPackageJson,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'Failed to sync agent',
    };
  }

  const response = result.response || {};
  return {
    success: true,
    action: response.action as 'created' | 'updated',
    agentId: response.agentId,
  };
}

export async function getAgentFromATP(options: {
  ensName?: string;
  agentName?: string;
  agentAccount?: string;
}): Promise<{ success: boolean; agent?: any; error?: string }> {
  const result = await sendA2AMessageToATP('atp.agent.get', {
    ens_name: options.ensName,
    agent_name: options.agentName,
    agent_account: options.agentAccount,
  });

  if (!result.success) {
    return { success: false, error: result.error || 'Failed to fetch agent' };
  }

  const response = result.response || {};
  return { success: true, agent: response.agent ?? null };
}

export async function updateAgentCardConfigInATP(
  agentName: string,
  agentAccount: string,
  agentCardJson: string | null,
  options?: {
    ensName?: string;
    emailDomain?: string;
    chainId?: number;
  },
): Promise<{ success: boolean; action?: 'created' | 'updated'; agentId?: number; error?: string }> {
  const result = await sendA2AMessageToATP('atp.agent.createOrUpdate', {
    agent_name: agentName,
    agent_account: agentAccount,
    ens_name: options?.ensName,
    email_domain: options?.emailDomain,
    chain_id: options?.chainId,
    agent_card_json: agentCardJson === null ? null : String(agentCardJson),
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error || 'Failed to update agent card config',
    };
  }

  const response = result.response || {};
  return {
    success: true,
    action: response.action as 'created' | 'updated',
    agentId: response.agentId,
  };
}

