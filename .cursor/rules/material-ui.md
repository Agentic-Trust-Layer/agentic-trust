# Material Design UI (MUI) Guidelines

## Styling
1. **Prefer `sx` prop**: Use the `sx` prop for styling components directly. Avoid inline `style` objects or CSS files unless absolutely necessary.

2. **Strictly enforce Theme Usage**: Always access colors, spacing, and breakpoints through the theme.
   - Use `theme.palette.primary.main`, `theme.palette.text.secondary`, etc., instead of hardcoded hex codes.
   - Use `theme.spacing(2)` (or just `2` inside `sx` for spacing props) instead of `16px` or `1rem`.
   - Use `theme.breakpoints.up('md')` for responsive designs.

## Components
- Use MUI components whenever possible (e.g., `Box`, `Stack`, `Container`) instead of `div`.
- Use the `Typography` component with appropriate `variant` props instead of native HTML tags like `h1`, `h2`, `p`.
- Prefer named imports: `import { Box, Typography } from '@mui/material';`

## Common Components
- `Button`, `Card`, `CardContent` for UI elements
- `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions` for modals
- `TextField` for form inputs
- `Typography` for text
- `Box`, `Container`, `Grid` for layout

## Theming
- Use theme palette for colors
- Use theme spacing for consistent margins/padding
- Access theme in `sx`: `sx={(theme) => ({ ... })}`

## Responsive Design
- Use MUI breakpoints for responsive layouts
- Use `Grid` component for responsive grids
- Test on different screen sizes

