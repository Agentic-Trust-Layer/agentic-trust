import { buildDidEthr } from '../../shared/didEthr';

export async function generateHcs14UaidDidTarget(params: {
  chainId: number;
  account: `0x${string}`;
  /**
   * Optional UAID routing params (HCS-14).
   * These become `;key=value` segments on the UAID.
   */
  routing?: {
    registry?: string;
    proto?: string;
    nativeId?: string;
    uid?: string;
    domain?: string;
    src?: string;
  };
}): Promise<string> {
  const didEthr = buildDidEthr(params.chainId, params.account, { encode: false });

  const { HCS14Client } = await import('@hashgraphonline/standards-sdk');
  const hcs14 = new HCS14Client();

  // HCS-14 DID target form: pass an existing DID into createUaid(existingDid, params)
  const uaid = (hcs14.createUaid as any)(didEthr, params.routing || undefined);
  return String(uaid);
}


