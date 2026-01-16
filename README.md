# ⚓ Battleship — ZK Blockchain Multiplayer

[![Next.js](https://img.shields.io/badge/Next.js-16.1.1-000000?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.0-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![wagmi](https://img.shields.io/badge/wagmi-2.0-000000?style=flat-square)](https://wagmi.sh/)

A modern Zero-Knowledge-enabled Battleship game built with Next.js, featuring P2P multiplayer, on-chain stakes, and pixel-art aesthetics.

## 🚀 Live Demo

[Play Now](https://todo.vercel.app) • [Game Rules](#-game-features)

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Quick Start](#-quick-start)
- [Environment Setup](#-environment-setup)
- [Development](#-development)
- [API Documentation](#-api-documentation)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)

## ✨ Features

### 🎮 Game Features

- **6×6 Grid Battleship** — Classic gameplay with modern UI
- **Zero-Knowledge Proofs** — Hide ship positions until revealed
- **On-chain Stakes** — ETH wagering with smart contracts
- **Dual Network Modes** — Choose between P2P or PartyKit networking
  - **P2P Mode** — Direct peer-to-peer via Trystero/Supabase
  - **PartyKit Mode** — Real-time WebSocket with online status indicators
- **Wallet Integration** — Connect with Wallet, WalletConnect, etc.

### 🎨 UI/UX Features

- **Responsive Design** — Works on desktop and mobile
- **Dark Theme** — Sleek blue gradient interface
- **Turn Indicators** — Clear "Your Turn" / "Enemy's Turn" states
- **Game History** — Track wins, losses, and earnings

### ⚡ Technical Features

- **P2P Config Caching** — 6-hour localStorage cache for optimal performance
- **Mock P2P Mode** — Local development without external dependencies
- **Dynamic ICE Servers** — Auto-configured TURN/STUN from Cloudflare
- **Type Safety** — Full TypeScript coverage

## 🏗 Architecture

```
┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Smart         │
│   (Next.js)     │◄──►│   Contract      │
│                 │    │   (Arbitrum)    │
└─────────────────┘    └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│         Network Layer (Choose One)       │
├─────────────────┬───────────────────────┤
│  P2P (Trystero) │  PartyKit WebSocket   │
│  + Supabase     │  + Lobby Server       │
│  + TURN/STUN    │  + Online Status      │
└─────────────────┴───────────────────────┘
```

### Key Components

- **Game Manager** — Core game logic and state management
- **Trystero Manager** — P2P connection handling with config caching
- **Contract Interface** — Blockchain interaction layer
- **Board Components** — Interactive game grid rendering

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Wallet with Arbitrum Sepolia ETH
- Supabase project (for P2P signaling)
- Cloudflare account with TURN access

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local
```

## 🔧 Environment Setup

Create `.env.local` in your project root:

```bash
# Network Configuration (Choose One)

# Option 1: P2P Mode (Trystero + Supabase)
NEXT_PUBLIC_USE_P2P=true
NEXT_PUBLIC_USE_PARTYKIT=false
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
CLOUDFLARE_TURN_ID=your-turn-key-id           # Optional
CLOUDFLARE_TURN_API=your-turn-api-token       # Optional

# Option 2: PartyKit Mode (WebSocket + Lobby)
NEXT_PUBLIC_USE_P2P=false
NEXT_PUBLIC_USE_PARTYKIT=true
NEXT_PUBLIC_PARTYKIT_HOST="localhost:1999"    # Local dev
# NEXT_PUBLIC_PARTYKIT_HOST="xxx.xxx.partykit.dev"  # Production

# Development Mode
NEXT_PUBLIC_USE_MOCK_P2P=false  # Set to 'true' for offline P2P testing
```

### Getting Credentials

🔹 Supabase Setup

1. Create a [Supabase project](https://supabase.com/dashboard)
2. Go to **Settings** → **API**
3. Copy your **Project URL** and **anon/public key**
4. No database setup required (used only for P2P signaling)

🔹 Cloudflare TURN Setup (Optional - P2P Mode Only)

1. Go to [Cloudflare Calls](https://dash.cloudflare.com/calls)
2. Create a **TURN key**
3. Copy the **Key ID** and **API Token**
4. Improves P2P connectivity behind NATs/firewalls

🔹 PartyKit Setup (Alternative to P2P)

1. Install PartyKit CLI: `npm install -g partykit`
2. For local development:
   ```bash
   npx partykit dev  # Starts on localhost:1999
   ```
3. For production:
   ```bash
   npx partykit deploy
   # Use the provided URL as NEXT_PUBLIC_PARTYKIT_HOST
   ```
4. **Benefits**: Real-time lobby with online status indicators

## 🛠 Development

### Start Development Server

```bash
npm run dev
```

Visit [http://localhost:3000/login](http://localhost:3000/login)

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production  
npm run start        # Start production server
npm run type-check   # Run TypeScript checks
npm run lint         # Run ESLint

# PartyKit (if using PartyKit mode)
npx partykit dev     # Start PartyKit server (localhost:1999)
npx partykit deploy  # Deploy to production
```

### Development Modes

**PartyKit Mode** (Recommended):

```bash
# Terminal 1: Start PartyKit server
npx partykit dev

# Terminal 2: Start Next.js app
npm run dev

# Set in .env.local:
# NEXT_PUBLIC_USE_PARTYKIT=true
# NEXT_PUBLIC_PARTYKIT_HOST="localhost:1999"
```

**P2P Mode**:

```bash
# Requires Supabase credentials
npm run dev

# Set in .env.local:
# NEXT_PUBLIC_USE_P2P=true
# NEXT_PUBLIC_USE_PARTYKIT=false
```

**Mock P2P Mode** (Offline testing):

```bash
# Enable mock mode
echo "NEXT_PUBLIC_USE_MOCK_P2P=true" >> .env.local

# Start development
npm run dev
```

## 📡 API Documentation

### GET `/api/p2p-config`

Returns P2P configuration with dynamic ICE servers.

**Response:**

```json
{
  "appId": "https://your-project.supabase.co",
  "supabaseKey": "eyJhbGciOiJIUzI1NiIs...",
  "rtcConfig": {
    "iceServers": [
      {
        "urls": ["stun:stun.cloudflare.com:3478"]
      },
      {
        "urls": [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turns:turn.cloudflare.com:443?transport=tcp"
        ],
        "username": "g0068953dd027db83...",
        "credential": "63d13d8895782f4e..."
      }
    ]
  }
}
```

**Caching Strategy:**

- Client caches response for 6 hours
- Automatic fallback to STUN-only if TURN fails
- Expired cache used if API unavailable

**Testing:**

```bash
curl http://localhost:3000/api/p2p-config | jq
```

## 🔧 Troubleshooting

### Common Issues

❓ "Server configuration error" in API

**Problem:** Missing environment variables

**Solution:**

```bash
# Check if variables are set
echo $SUPABASE_URL
echo $SUPABASE_ANON_KEY

# Add to .env.local if missing
```

❓ P2P connection fails

**Problem:** Network restrictions or missing TURN servers

**Solutions:**

1. Enable Cloudflare TURN credentials
2. Check firewall settings
3. Switch to PartyKit mode: `NEXT_PUBLIC_USE_PARTYKIT=true`
4. Try mock P2P mode: `NEXT_PUBLIC_USE_MOCK_P2P=true`

❓ PartyKit connection fails

**Problem:** PartyKit server not running or wrong host

**Solutions:**

1. Start PartyKit server: `npx partykit dev`
2. Verify host in `.env.local` matches server URL
3. Check if port 1999 is available (local dev)
4. For production, ensure deployment succeeded

❓ Wallet connection issues

**Problem:** Wrong network or wallet setup

**Solution:**

1. Switch to **Arbitrum Sepolia** network
2. Add network to wallet:
   - RPC: `https://sepolia-rollup.arbitrum.io/rpc`
   - Chain ID: `421614`
   - Currency: `ETH`

## 🤝 Contributing

We welcome contributions!

## 📄 License

See the [LICENSE](LICENSE) file for details.
