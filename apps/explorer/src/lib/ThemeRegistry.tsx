'use client';

import * as React from 'react';
import { useState } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#4338CA',
    },
    secondary: {
      main: '#0EA5E9',
    },
    background: {
      default: '#F5F7FF',
      paper: '#FFFFFF',
    },
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h3: {
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
  },
});

function createEmotionCache() {
  const cache = createCache({ key: 'mui', prepend: true });
  cache.compat = true;
  return cache;
}

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
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

