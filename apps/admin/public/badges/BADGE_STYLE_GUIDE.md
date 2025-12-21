# Badge Style Guide

This directory contains validation badges for the Agent Trust application.

## Quick Reference

See `.cursor/rules/badge-generation.mdc` for complete cursor rules and generation prompts.

## Badge Files

Place generated badge SVGs in this directory:
- `badge-validation-name.svg`
- `badge-validation-account.svg`
- `badge-validation-app.svg`
- `badge-association-movie-alliance.svg`
- `badge-agent-movie-reviewer.svg`

## Usage

Badges should be referenced from the `/badges/` public path in Next.js:

```tsx
import Image from 'next/image';

<Image 
  src="/badges/badge-validation-name.svg" 
  alt="Name Validation Badge"
  width={64}
  height={64}
/>
```

## Generation

Use the cursor rules in `.cursor/rules/badge-generation.mdc` with Prompt A to generate the initial SVGs.

