export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import type { MessageRequest } from '@agentic-trust/core/server';

/**
 * GET /api/messages - List messages for a specific agent DID
 * Uses atp.inbox.listAgentMessages skill via agents-atp
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const agentDid = searchParams.get('agentDid');

    if (!agentDid) {
      return NextResponse.json(
        { error: 'agentDid query parameter is required' },
        { status: 400 }
      );
    }

    // Send request to agents-atp endpoint
    const response = await fetch('https://agents-atp.8004-agent.io/api/a2a', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillId: 'atp.inbox.listAgentMessages',
        payload: {
          agentDid,
        },
      } as MessageRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Failed to fetch messages: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const rawMessages = data.response?.messages || data.messages || [];
    const messages = Array.isArray(rawMessages)
      ? rawMessages.map((m: any) => ({
          id: m.id,
          subject: m.subject || null,
          body: m.body || '',
          contextType: m.contextType || m.context_type || 'general',
          contextId: m.contextId || m.context_id || null,
          taskId: m.taskId ?? m.task_id ?? null,
          taskType: m.taskType ?? m.task_type ?? null,
          fromAgentDid: m.fromAgentDid || m.from_agent_did || null,
          fromAgentName: m.fromAgentName || m.from_agent_name || null,
          toAgentDid: m.toAgentDid || m.to_agent_did || null,
          toAgentName: m.toAgentName || m.to_agent_name || null,
          fromClientAddress: m.fromClientAddress || m.from_client_address || null,
          toClientAddress: m.toClientAddress || m.to_client_address || null,
          createdAt: m.createdAt ?? m.created_at ?? null,
          readAt: m.readAt ?? m.read_at ?? null,
          // association_request extras (stored as metadata fields)
          associationType: m.associationType ?? m.association_type ?? null,
          associationDescription: m.associationDescription ?? m.association_description ?? null,
          associationPayload: m.associationPayload ?? m.association_payload ?? null,
        }))
      : [];
    return NextResponse.json({ messages });
  } catch (error: any) {
    console.error('[Messages API] Error fetching messages:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/messages - Send a message
 * Uses atp.inbox.sendMessage skill via agents-atp
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      type,
      content,
      metadata,
      fromClientAddress,
      fromAgentDid,
      fromAgentName,
      toClientAddress,
      toAgentDid,
      toAgentName,
      subject,
      taskId,
    } = body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json(
        { error: 'Message content is required' },
        { status: 400 }
      );
    }

    const typeStr = typeof type === 'string' ? type : undefined;
    const k = typeStr?.toLowerCase() || '';
    const shouldAutoTask =
      (k.includes('feedback') && (k.includes('auth') || k.includes('request'))) ||
      (k.includes('validation') && k.includes('request')) ||
      (k.includes('association') && k.includes('request'));
    const resolvedTaskId =
      typeof taskId === 'string' && taskId.trim().length > 0
        ? taskId.trim()
        : shouldAutoTask
          ? `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
          : null;

    // Send message to agents-atp endpoint
    const response = await fetch('https://agents-atp.8004-agent.io/api/a2a', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        skillId: 'atp.inbox.sendMessage',
        payload: {
          fromClientAddress,
          fromAgentDid,
          fromAgentName,
          toClientAddress,
          toAgentDid,
          toAgentName,
          subject: subject || (type ? `${type} message` : 'Message'),
          body: content.trim(),
          contextType: type || 'general',
          ...(resolvedTaskId ? { contextId: resolvedTaskId } : {}),
          ...(metadata || {}),
        },
      } as MessageRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      
      return NextResponse.json(
        { error: errorData.error || errorData.message || 'Failed to send message' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      message: data.response,
    });
  } catch (error: any) {
    console.error('[Messages API] Error sending message:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to send message' },
      { status: 500 }
    );
  }
}

