import { Html, Head, Main, NextScript } from 'next/document';

/**
 * Custom Document used by Next.js when building the legacy `pages` router.
 * The Admin app primarily uses the App Router, but Next still looks for
 * `/pages/_document` during the build process. Providing this thin wrapper
 * allows the build to succeed while delegating to the defaults.
 */
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

