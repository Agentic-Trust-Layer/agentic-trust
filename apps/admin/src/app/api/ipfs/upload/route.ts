import { NextRequest, NextResponse } from 'next/server';
import { getIPFSStorage } from '@agentic-trust/core/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Missing file in form data.' },
        { status: 400 },
      );
    }

    const storage = getIPFSStorage();
    const uploadResult = await storage.upload(file, file.name);

    return NextResponse.json({
      cid: uploadResult.cid,
      url: uploadResult.url,
      tokenUri: uploadResult.tokenUri,
      size: uploadResult.size ?? file.size,
      filename: file.name,
      mimeType: file.type,
    });
  } catch (error) {
    console.error('[api/ipfs/upload] Failed to upload file', error);
    return NextResponse.json(
      {
        error: 'Failed to upload file to IPFS.',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

