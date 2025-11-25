'use client';

import * as React from 'react';
import { useState } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { grayscalePalette as palette } from '@/styles/palette';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#111827',
    },
    secondary: {
      main: '#4b5563',
    },
    background: {
      default: palette.background,
      paper: palette.surface,
    },
    text: {
      primary: palette.textPrimary,
      secondary: palette.textSecondary,
    },
    divider: palette.border,
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: {
      fontWeight: 600,
      letterSpacing: '-0.02em',
    },
    h2: {
      fontWeight: 600,
      letterSpacing: '-0.02em',
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
    },
  },
});

function createEmotionCache() {
  const cache = createCache({ key: 'mui-admin', prepend: true });
  cache.compat = true;
  return cache;
}

export function ThemeRegistry({ children }: { children: React.ReactNode }) {
  const [cache] = useState(() => createEmotionCache());

  useServerInsertedHTML(() => {
    const { key, inserted } = cache;
    const names = Object.keys(inserted);
    if (names.length === 0) {
      return null;
    }

    const styles = names.map((name) => inserted[name]).join('');
    names.forEach((name) => {
      delete inserted[name];
    });

    return (
      <style
        data-emotion={`${key} ${names.join(' ')}`}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}


