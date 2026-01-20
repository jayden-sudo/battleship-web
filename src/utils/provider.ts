/**
 * Provider utilities for EIP-6963 compatibility
 * 
 * This module provides utilities to work with Ethereum providers
 * in a way that's compatible with EIP-6963 (Multi Injected Provider Discovery).
 * 
 * Always use these utilities instead of directly accessing window.ethereum
 * to ensure compatibility with multiple wallet providers.
 */

import { BrowserProvider, JsonRpcSigner } from 'ethers'
import type { WalletClient } from 'viem'

/**
 * Creates an ethers.js BrowserProvider from a wagmi WalletClient
 * This ensures EIP-6963 compatibility by using wagmi's provider discovery
 * 
 * @param walletClient - The WalletClient from wagmi's useWalletClient hook
 * @returns BrowserProvider instance
 */
export function walletClientToProvider(walletClient: WalletClient): BrowserProvider {
  // wagmi's WalletClient is compatible with ethers' Eip1193Provider interface
  return new BrowserProvider(walletClient as any)
}

/**
 * Gets a signer from a wagmi WalletClient
 * This is the EIP-6963 compatible way to get a signer
 * 
 * @param walletClient - The WalletClient from wagmi's useWalletClient hook
 * @returns JsonRpcSigner instance
 */
export async function walletClientToSigner(walletClient: WalletClient): Promise<JsonRpcSigner> {
  const provider = walletClientToProvider(walletClient)
  return provider.getSigner()
}

/**
 * Gets both provider and signer from a wagmi WalletClient
 * 
 * @param walletClient - The WalletClient from wagmi's useWalletClient hook
 * @returns Object with provider and signer
 */
export async function getProviderAndSigner(walletClient: WalletClient) {
  const provider = walletClientToProvider(walletClient)
  const signer = await provider.getSigner()
  return { provider, signer }
}
