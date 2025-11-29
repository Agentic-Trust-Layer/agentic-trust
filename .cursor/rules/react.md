# React Rules

## Component Patterns
- Use functional components with hooks
- Use `React.useCallback` for event handlers passed as props
- Use `React.useMemo` for expensive computations
- Use `React.useState` for local component state

## Hooks
- Custom hooks should start with `use` prefix
- Extract reusable logic into custom hooks
- Keep hooks focused and single-purpose

## Performance
- Memoize callbacks passed to child components
- Use `React.memo` for expensive components
- Avoid creating objects/arrays in render (use useMemo/useCallback)

## State Management
- Use React Context for shared state (connection, Web3Auth, default agent)
- Use local state for component-specific data
- Avoid prop drilling - use context providers

