export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

export async function GET() {
  const networkRaw = String(process.env.HOL_HEDERA_NETWORK ?? '').trim().toLowerCase();
  const network = networkRaw === 'testnet' || networkRaw === 'mainnet' ? networkRaw : 'mainnet';
  return NextResponse.json({ ok: true, network });
}

