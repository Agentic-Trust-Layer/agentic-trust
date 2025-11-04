# Troubleshooting

## Port Already in Use (EADDRINUSE)

If you see an error like:
```
Error: listen EADDRINUSE: address already in use :::3001
```

### Solution 1: Use a Different Port

Run the dev server on a different port:

```bash
PORT=3002 pnpm dev
```

### Solution 2: Find and Kill the Process Using Port 3001

```bash
# Find the process
lsof -ti:3001

# Kill it (replace PID with the process ID from above)
kill -9 <PID>
```

Or use:

```bash
# Kill all Next.js processes on port 3001
pkill -f "next dev.*3001"
```

### Solution 3: Wait a Moment

Sometimes the port is in TIME_WAIT state after a process closes. Wait 10-30 seconds and try again.

### Solution 4: Check for Zombie Processes

```bash
ps aux | grep next
# Kill any zombie Next.js processes
pkill -9 next
```

## Change Default Port Permanently

Edit `package.json` and change the port in the dev script:
```json
{
  "scripts": {
    "dev": "next dev -p 3002"
  }
}
```

