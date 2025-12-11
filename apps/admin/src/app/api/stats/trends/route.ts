export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import type { MessageRequest } from '@agentic-trust/core/server';

/**
 * GET /api/stats/trends - Fetch daily trends (members, agents, events)
 * Uses agent.stats.trends skill via agents-atp
 */
let cachedTrends: any | null = null;
let cachedTrendsAt: number | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function GET(request: NextRequest) {
  console.log('[Stats Trends API] GET request received');
  try {
    const now = Date.now();
    const refresh = request.nextUrl.searchParams.get('refresh') === '1';
    if (refresh) {
      console.log('[Stats Trends API] refresh=1 -> bypassing cache');
      cachedTrends = null;
      cachedTrendsAt = null;
    }

    if (cachedTrends && cachedTrendsAt && now - cachedTrendsAt < CACHE_TTL_MS) {
      const age = Math.round((now - cachedTrendsAt) / 1000);
      console.log('[Stats Trends API] returning cached trends (age:', age, 'seconds)');
      console.log('[Stats Trends API] Cached trends keys:', Object.keys(cachedTrends || {}));
      console.log('[Stats Trends API] Cached dailyMembers length:', cachedTrends?.dailyMembers?.length || 0);
      console.log('[Stats Trends API] Cached dailyAgents length:', cachedTrends?.dailyAgents?.length || 0);
      console.log('[Stats Trends API] Cached dailyEvents length:', cachedTrends?.dailyEvents?.length || 0);
      
      // Validate cached data - if empty, clear cache and fetch fresh
      const hasCachedData = (cachedTrends.dailyMembers && cachedTrends.dailyMembers.length > 0) ||
                            (cachedTrends.dailyAgents && cachedTrends.dailyAgents.length > 0) ||
                            (cachedTrends.dailyEvents && cachedTrends.dailyEvents.length > 0) ||
                            (cachedTrends.dailySdkApps && cachedTrends.dailySdkApps.length > 0) ||
                            (cachedTrends.sdkApps && cachedTrends.sdkApps.length > 0);
      
      if (!hasCachedData) {
        console.warn('[Stats Trends API] Cached data is empty, clearing cache and fetching fresh');
        cachedTrends = null;
        cachedTrendsAt = null;
        // Fall through to fetch fresh data
      } else {
        return NextResponse.json(
          { trends: cachedTrends },
          { headers: { 'X-Stats-Trends-Cache': 'hit' } },
        );
      }
    }

    console.log('[Stats Trends API] Cache miss or expired, fetching trends from agents-atp.8004-agent.io/api/a2a');
    const requestPayload = {
      skillId: 'agent.stats.trends',
      payload: {
        _timestamp: Date.now(), // Add timestamp to prevent caching
        ...(refresh ? { refresh: true } : {}),
      },
    };
    console.log('[Stats Trends API] Request payload:', JSON.stringify(requestPayload));
    
    const response = await fetch('https://agents-atp.8004-agent.io/api/a2a', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
      body: JSON.stringify(requestPayload as MessageRequest),
      cache: 'no-store',
    });

    console.log('[Stats Trends API] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Stats Trends API] upstream error', response.status, errorText);
      // Don't cache errors - return error but allow retry
      return NextResponse.json(
        { error: `Failed to fetch trends: ${errorText}` },
        { status: response.status, headers: { 'X-Stats-Trends-Cache': 'miss' } },
      );
    }

    const responseText = await response.text();
    console.log('[Stats Trends API] Raw response length:', responseText.length);
    console.log('[Stats Trends API] Raw response preview (first 500 chars):', responseText.substring(0, 500));
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[Stats Trends API] JSON parse error:', parseError);
      console.error('[Stats Trends API] Response text:', responseText);
      return NextResponse.json(
        { error: 'Failed to parse response from agents-atp' },
        { status: 500 }
      );
    }
    console.log('[Stats Trends API] Response data keys:', Object.keys(data));
    console.log('[Stats Trends API] Response.response keys:', data.response ? Object.keys(data.response) : 'no response');
    console.log('[Stats Trends API] data.response?.trends exists:', !!data.response?.trends);
    console.log('[Stats Trends API] data.response?.trends type:', typeof data.response?.trends);
    if (data.response?.trends) {
      console.log('[Stats Trends API] data.response.trends keys:', Object.keys(data.response.trends));
      console.log('[Stats Trends API] data.response.trends.dailyMembers length:', data.response.trends.dailyMembers?.length || 0);
      console.log('[Stats Trends API] data.response.trends.dailyAgents length:', data.response.trends.dailyAgents?.length || 0);
      console.log('[Stats Trends API] data.response.trends.dailyEvents length:', data.response.trends.dailyEvents?.length || 0);
    }
    
    const trends = data.response?.trends || data.trends || {};
    console.log('[Stats Trends API] Extracted trends keys:', Object.keys(trends));
    console.log('[Stats Trends API] Extracted trends type:', typeof trends);
    console.log('[Stats Trends API] dailyMembers length:', trends?.dailyMembers?.length || 0);
    console.log('[Stats Trends API] dailyAgents length:', trends?.dailyAgents?.length || 0);
    console.log('[Stats Trends API] dailyEvents length:', trends?.dailyEvents?.length || 0);
    console.log('[Stats Trends API] dailySdkApps length:', trends?.dailySdkApps?.length || 0);
    console.log('[Stats Trends API] sdkApps length:', trends?.sdkApps?.length || 0);
    
    // Validate trends data - only cache if we have actual data
    if (!trends || (Object.keys(trends).length === 0)) {
      console.warn('[Stats Trends API] Empty trends data received, not caching');
      return NextResponse.json({ trends: {} }, { headers: { 'X-Stats-Trends-Cache': 'miss' } });
    }
    
    // Check if we have at least one array with data
    const hasData = (trends.dailyMembers && trends.dailyMembers.length > 0) ||
                    (trends.dailyAgents && trends.dailyAgents.length > 0) ||
                    (trends.dailyEvents && trends.dailyEvents.length > 0) ||
                    (trends.dailySdkApps && trends.dailySdkApps.length > 0) ||
                    (trends.sdkApps && trends.sdkApps.length > 0);
    
    if (!hasData) {
      console.warn('[Stats Trends API] Trends data has no actual data arrays, not caching');
      // Clear invalid cache
      cachedTrends = null;
      cachedTrendsAt = null;
      return NextResponse.json({ trends }, { headers: { 'X-Stats-Trends-Cache': 'miss' } });
    }
    
    cachedTrends = trends;
    cachedTrendsAt = now;
    console.log('[Stats Trends API] fetched trends successfully, cached. Trends keys:', Object.keys(trends));
    return NextResponse.json(
      { trends },
      { headers: { 'X-Stats-Trends-Cache': refresh ? 'bypass' : 'miss' } },
    );
  } catch (error: any) {
    console.error('[Stats Trends API] Error fetching trends:', error);
    console.error('[Stats Trends API] Error stack:', error?.stack);
    // Don't cache errors
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch trends' },
      { status: 500, headers: { 'X-Stats-Trends-Cache': 'error' } },
    );
  }
}


