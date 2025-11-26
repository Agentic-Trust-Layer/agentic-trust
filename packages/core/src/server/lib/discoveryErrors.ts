function extractGraphQLErrorMessages(error: unknown): string[] {
  const messages: string[] = [];

  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    messages.push(error.message.trim());
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response: unknown }).response === 'object' &&
    (error as { response: { errors?: unknown } }).response !== null
  ) {
    const response = (error as { response: { errors?: unknown } }).response;
    if (Array.isArray(response.errors)) {
      for (const entry of response.errors as Array<{ message?: unknown }>) {
        if (typeof entry?.message === 'string' && entry.message.trim()) {
          messages.push(entry.message.trim());
        }
      }
    }
  }

  return messages;
}

function resolveStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response: unknown }).response === 'object' &&
    (error as { response: { status?: unknown } }).response !== null
  ) {
    const response = (error as { response: { status?: unknown; statusCode?: unknown } }).response;
    const status = response.status ?? (response as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

function isAccessCodeError(error: unknown): boolean {
  const status = resolveStatus(error);
  const combinedMessage = extractGraphQLErrorMessages(error).join(' ').toLowerCase();

  if (typeof status === 'number' && (status === 401 || status === 403)) {
    return true;
  }

  if (!combinedMessage) {
    return false;
  }

  return (
    combinedMessage.includes('access code') ||
    combinedMessage.includes('authorization header') ||
    combinedMessage.includes('api key') ||
    combinedMessage.includes('unauthorized')
  );
}

function buildAccessCodeMessage(context: string | undefined): string {
  const prefix = context ? `[AgenticTrust:${context}] ` : '[AgenticTrust] ';
  return (
    `${prefix}Missing required environment variable: AGENTIC_TRUST_DISCOVERY_API_KEY. ` +
    `The discovery API rejected the request because no access code was provided. ` +
    `Set the AGENTIC_TRUST_DISCOVERY_API_KEY environment variable (or provide the apiKey field when ` +
    `creating AgenticTrustClient) with your Agentic Trust access code. You can generate or ` +
    `copy your access code by logging in to https://agentictrust.io and opening the API Keys section.`
  );
}

/**
 * Throws a friendly error message for discovery GraphQL authorization failures.
 * Re-throws the original error if it is unrelated to missing credentials.
 */
export function rethrowDiscoveryError(error: unknown, context?: string): never {
  if (isAccessCodeError(error)) {
    const friendlyError = new Error(buildAccessCodeMessage(context));
    if (error instanceof Error) {
      (friendlyError as Error & { cause?: Error }).cause = error;
    }
    throw friendlyError;
  }

  if (error instanceof Error) {
    throw error;
  }

  throw new Error((context ? `[AgenticTrust:${context}] ` : '[AgenticTrust] ') + 'Unknown discovery error.');
}

