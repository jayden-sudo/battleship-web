'use client'

import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { arbitrumSepolia } from 'wagmi/chains'

export function NetworkGuard({ children }: { children: React.ReactNode }) {
  const { isConnected, address } = useAccount()
  const chainId = useChainId()
  const router = useRouter()
  const { switchChain } = useSwitchChain()

  useEffect(() => {
    // If not connected, redirect to login
    if (!isConnected || !address) {
      router.push('/')
      return
    }

    // If connected but wrong network, try to switch or redirect to login
    if (chainId !== arbitrumSepolia.id) {
      // Try to switch network automatically
      if (switchChain) {
        switchChain({ chainId: arbitrumSepolia.id })
      } else {
        // If can't switch, redirect to login
        router.push('/')
      }
    }
  }, [isConnected, address, chainId, router, switchChain])

  // Only render children if connected and on correct network
  if (!isConnected || !address || chainId !== arbitrumSepolia.id) {
    return null
  }

  return <>{children}</>
}
