# Server Manager

Next.js 16 app for managing Docker containers, browsing files, viewing system info, and opening a live terminal.

## Requirements

- Node.js 20+
- PostgreSQL
- Docker Engine

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Update `.env` with your PostgreSQL and NextAuth values.

4. Generate the Prisma client and apply migrations:

```bash
npx prisma generate
npx prisma migrate deploy
```

5. Start the app:

```bash
npm run dev
```

## Ubuntu Notes

- The file manager now defaults to the project root instead of the whole filesystem.
- If you set `FILE_MANAGER_ROOT="/"`, the app can browse the full filesystem.
- Write-like actions are blocked inside protected paths from `FILE_MANAGER_PROTECTED_PATHS`.
- Linux defaults for protected paths are `/etc`, `/boot`, `/proc`, `/sys`, and `/dev`.
- The live terminal now starts in the project root by default.
- Docker on Ubuntu uses `/var/run/docker.sock` automatically.
- If the app cannot access Docker, add your user to the `docker` group or run the app with permission to access the Docker socket.

Example Docker permission command:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string
- `NEXTAUTH_URL`: public URL of the app
- `NEXTAUTH_SECRET`: secret used by NextAuth
- `CORS_ALLOWED_ORIGINS`: optional comma-separated origins allowed for cross-origin API access
- `ALLOW_PUBLIC_REGISTRATION`: optional toggle to disable open registration
- `FILE_MANAGER_ROOT`: optional directory exposed by the file manager
- `FILE_MANAGER_PROTECTED_PATHS`: optional comma-separated list of paths that cannot be edited, created in, renamed, or deleted
- `TERMINAL_ROOT_PATH`: optional starting directory for terminal sessions
- `TERMINAL_SHELL`: optional shell override
- `TERMINAL_WS_HOST`: optional websocket bind host for the live terminal
- `DOCKER_HOST`: optional Docker host such as `tcp://127.0.0.1:2375` or `unix:///var/run/docker.sock`
- `DOCKER_SOCKET_PATH`: optional Unix socket override

## Production

```bash
npm run build
npm run start
```
