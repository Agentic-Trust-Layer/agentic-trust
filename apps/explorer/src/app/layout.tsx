import './globals.css';
import type { ReactNode } from 'react';
import ThemeRegistry from '@/lib/ThemeRegistry';
import { Box, Container, Stack, Typography } from '@mui/material';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeRegistry>
          <Box
            sx={{
              minHeight: '100vh',
              bgcolor: 'background.default',
            }}
          >
            <Container
              maxWidth="lg"
              sx={{
                py: { xs: 6, md: 8 },
              }}
            >
              <Stack spacing={1.5} mb={5}>
                <Typography component="h1" variant="h3">
                  Agent Explorer
                </Typography>
                <Typography variant="subtitle1" color="text.secondary">
                  Discover registered agents across the Agentic Trust network.
                </Typography>
              </Stack>
              {children}
            </Container>
          </Box>
        </ThemeRegistry>
      </body>
    </html>
  );
}

