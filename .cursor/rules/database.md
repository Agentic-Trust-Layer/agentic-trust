# Database Rules

## D1 Database (Cloudflare)
- Use `getD1Database()` from `lib/d1-wrapper` for database access
- Handle both native binding and Wrangler CLI fallback
- Use prepared statements: `db.prepare('SELECT ...').bind(...)`

## Database Operations
- Always use transactions for multi-step operations
- Handle errors gracefully and return appropriate HTTP status codes
- Use parameterized queries to prevent SQL injection

## User Profiles
- Store in `individuals` table
- Associate with organizations via `individual_organizations` table
- Organizations stored in `organizations` table

## Data Validation
- Validate required fields before database operations
- Check for existing records before creating duplicates
- Use `is_primary` flag for primary organization associations

## Error Handling
- Return clear error messages for missing data
- Handle database connection failures gracefully
- Log errors for debugging but don't expose sensitive info

