'use client'

import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { arbitrumSepolia } from 'wagmi/chains'
import { GameBoardComponent } from '@/components/GameBoard'
import { GameBoard as GameBoardClass } from '@/utils/gameBoard'
import { DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES } from '@/utils/interfaces'
import { IntroAnimation, shouldShowIntro } from '@/components/IntroAnimation'

export default function LoginPage() {
  const [mounted, setMounted] = useState(false)
  const [showIntro, setShowIntro] = useState(false)
  const { isConnected, address } = useAccount()
  const chainId = useChainId()
  const router = useRouter()
  const { switchChain } = useSwitchChain()
  const [previewBoard, setPreviewBoard] = useState<GameBoardClass | null>(null)
  const [previewBoardVersion, setPreviewBoardVersion] = useState(0)


  useEffect(() => {
    setMounted(true)
    
    // Check if intro should be shown (first visit today)
    if (shouldShowIntro()) {
      setShowIntro(true)
    }
    
    // Initialize preview board
    const board = new GameBoardClass(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)
    board.initRandom()
    setPreviewBoard(board)
    
    // Refresh board every 0.5 seconds
    const interval = setInterval(() => {
      board.initRandom()
      setPreviewBoardVersion(v => v + 1)
    }, 500)
    
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // If connected and on the correct network, redirect to game
    if (mounted && isConnected && address && chainId === arbitrumSepolia.id) {
      router.push('/game')
    }
  }, [mounted, isConnected, address, chainId, router])

  const handleNetworkSwitch = () => {
    if (switchChain) {
      switchChain({ chainId: arbitrumSepolia.id })
    }
  }

  // Wait for client-side mounting
  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  return (
    <>
      {/* Intro Animation */}
      {/* {showIntro && (
        <IntroAnimation onComplete={() => setShowIntro(false)} />
      )} */}
      
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900">
        <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 space-y-6">
          {/* Title */}
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold text-gray-900">⚓ Battleship</h1>
            <p className="text-gray-600">Zero-Knowledge Blockchain Game</p>
          </div>

          {/* Battleship Grid Preview */}
          <div className="flex justify-center py-4">
            {previewBoard && (
              <div className="transform scale-75">
                <GameBoardComponent board={previewBoard}  version={previewBoardVersion}/>
              </div>
            )}
          </div>

          {/* Network Info */}
          <div className="bg-blue-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Network:</span>
              <span className="text-sm text-blue-600 font-semibold">
                Arbitrum Sepolia
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Chain ID:</span>
              <span className="text-sm text-gray-600">421614 (0x66eee)</span>
            </div>
          </div>

          {/* Connect Button */}
          <div className="space-y-4">
            <div className="flex justify-center">
              <ConnectButton 
                showBalance={false}
                chainStatus="icon"
                accountStatus="address"
              />
            </div>

            {/* Network Switch Button */}
            {isConnected && chainId !== arbitrumSepolia.id && (
              <div className="space-y-2">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-700 text-center">
                    ⚠️ Please switch to Arbitrum Sepolia network
                  </p>
                </div>
                <button
                  onClick={handleNetworkSwitch}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                >
                  Switch to Arbitrum Sepolia
                </button>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="text-center text-sm text-gray-500 space-y-1">
            <p>Connect your wallet to start playing</p>
            <p className="text-xs">Make sure you are on Arbitrum Sepolia network</p>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
