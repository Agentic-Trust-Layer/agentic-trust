'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

type BackToAgentsButtonProps = {
  fallbackHref?: string;
};

export default function BackToAgentsButton({
  fallbackHref = '/',
}: BackToAgentsButtonProps) {
  const router = useRouter();

  const handleClick = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [router, fallbackHref]);

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        border: 'none',
        background: 'none',
        color: '#2563eb',
        fontWeight: 600,
        fontSize: '0.95rem',
        cursor: 'pointer',
        padding: 0,
      }}
      aria-label="Back to agents"
    >
      <span aria-hidden="true">←</span>
      Back to Agents
    </button>
  );
}

