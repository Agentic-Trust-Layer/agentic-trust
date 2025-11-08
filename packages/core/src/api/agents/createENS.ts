/**
 * Reusable API handler for creating ENS names
 * Can be used by Next.js API routes
 */


export interface CreateENSRequestBody {
  agentName: string;
  orgName: string;
  agentAddress: `0x${string}`;
  agentUrl?: string;
}

export interface CreateENSResponse {
  success: boolean;
  txHashes?: string[];
  error?: string;
}

/**
 * Handle ENS name creation
 * 
 * @param body - Request body with ENS creation parameters
 * @param getClient - Function to get AgenticTrustClient instance
 * @returns Response data
 */
export async function handleCreateENS(
  body: CreateENSRequestBody
): Promise<CreateENSResponse> {
  try {
    const { agentName, orgName, agentAddress, agentUrl } = body;

    // Validate required fields
    if (!agentName || !orgName || !agentAddress) {
      console.error('Missing required fields:', { agentName, orgName, agentAddress });
      return {
        success: false,
        error: 'Missing required fields: agentName, orgName, and agentAddress are required',
      };
    }

    // Validate agentAddress format
    if (typeof agentAddress !== 'string' || !agentAddress.startsWith('0x') || agentAddress.length !== 42) {
      console.error('Invalid agentAddress format:', agentAddress);
      return {
        success: false,
        error: `Invalid agentAddress format: ${agentAddress}. Must be a valid Ethereum address (0x followed by 40 hex characters).`,
      };
    }

    // Get client and create ENS name
    const { createENSName } = await import('../../server/singletons/ensClient');
    
    // Get AdminApp's accountProvider for ENS creation
    const { getAdminApp } = await import('../../server/userApps/adminApp');
    const adminApp = await getAdminApp();
    
    if (!adminApp?.accountProvider) {
      return {
        success: false,
        error: 'AdminApp not initialized. Please authenticate first.',
      };
    }

    const txHashes = await createENSName(
      agentName,
      orgName,
      agentAddress,
      agentUrl,
      adminApp.accountProvider
    );

    return {
      success: true,
      txHashes,
    };
  } catch (error) {
    console.error('Error creating ENS name 1:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

