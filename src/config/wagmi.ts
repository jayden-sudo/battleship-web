"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arbitrumSepolia, arbitrum } from "wagmi/chains";

export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
export const ARBITRUM_CHAIN_ID = 42161;
export const ARBITRUM_SEPOLIA_CHAIN_ID_HEX = "0x66eee";
export const ARBITRUM_CHAIN_ID_HEX = "0xa4b1";

export const PUBLIC_RPC_URLS = {
  [ARBITRUM_SEPOLIA_CHAIN_ID]: "https://sepolia-rollup.arbitrum.io/rpc",
  [ARBITRUM_CHAIN_ID]: "https://arb1.arbitrum.io/rpc",
} as const;

export const ARBITRUM_SEPOLIA_RPC = PUBLIC_RPC_URLS[ARBITRUM_SEPOLIA_CHAIN_ID];

export function getPublicRpcUrl(chainId: number): string | undefined {
  return PUBLIC_RPC_URLS[chainId as keyof typeof PUBLIC_RPC_URLS];
}

export const config = getDefaultConfig({
  appName: "Battleship Game",
  projectId: "9f3116b9a6c0864696fed92e38e9a242",
  chains: [arbitrumSepolia],
  ssr: true,
});
