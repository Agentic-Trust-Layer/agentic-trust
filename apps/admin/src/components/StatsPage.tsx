'use client';

export function StatsPage() {
  return (
    <section
      style={{
        backgroundColor: '#fff',
        borderRadius: '16px',
        border: '1px solid #e2e8f0',
        padding: '2rem',
        boxShadow: '0 10px 30px rgba(15,23,42,0.08)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <div>
          <p
            style={{
              fontSize: '0.8rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: '#94a3b8',
              marginBottom: '0.25rem',
            }}
          >
            Analytics Preview
          </p>
          <h2 style={{ margin: 0, fontSize: '2rem' }}>Stats Dashboard</h2>
          <p style={{ margin: '0.5rem 0 0', color: '#475569' }}>
            Track agent registrations, active chains, and on-chain interactions. Detailed analytics
            will live here soon.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {[
          { label: 'Total Agents', value: '—', hint: 'Coming soon' },
          { label: 'Chains Supported', value: '—', hint: 'Coming soon' },
          { label: 'ENS Names', value: '—', hint: 'Coming soon' },
          { label: 'Recent Mints', value: '—', hint: 'Coming soon' },
        ].map(card => (
          <div
            key={card.label}
            style={{
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              padding: '1.25rem',
              backgroundColor: '#f8fafc',
            }}
          >
            <p style={{ margin: 0, color: '#64748b', fontWeight: 600 }}>{card.label}</p>
            <div style={{ fontSize: '2rem', fontWeight: 700, margin: '0.25rem 0' }}>
              {card.value}
            </div>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>{card.hint}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

