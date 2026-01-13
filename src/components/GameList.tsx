'use client'

import { GameData } from '@/utils/interfaces'
import { ethers } from 'ethers'

interface GameListProps {
  games: GameData[]
  onJoin: (game: GameData) => void
  onQuit: (game: GameData) => void
  onRefresh: () => void
  isLoading?: boolean
  currentUserAddress?: string
}

export function GameList({ games, onJoin, onQuit, onRefresh, isLoading, currentUserAddress }: GameListProps) {
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const formatTimestamp = (timestamp: bigint) => {
    const date = new Date(Number(timestamp) * 1000)
    return date.toLocaleString()
  }

  const formatStake = (stake: bigint) => {
    return ethers.formatEther(stake)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Available Games</h3>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 border-b">
              <th className="px-4 py-2 text-left">Creator</th>
              <th className="px-4 py-2 text-left">Created</th>
              <th className="px-4 py-2 text-right">Stake (ETH)</th>
              <th className="px-4 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {games.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No games available. Create a new game to start!
                </td>
              </tr>
            ) : (
              games.map((game, index) => {
                // Check if current user is the creator (case-insensitive comparison)
                const isOwnGame = !!(currentUserAddress && 
                  game.creator.toLowerCase() === currentUserAddress.toLowerCase())
                
                return (
                  <tr key={index} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono">
                      {formatAddress(game.creator)}
                    </td>
                    <td className="px-4 py-3">
                      {formatTimestamp(game.lastActiveTimestamp)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {formatStake(game.stake)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isOwnGame ? (
                        <button
                          onClick={() => onQuit(game)}
                          className="px-4 py-1 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                          title="Close your game"
                        >
                          Quit
                        </button>
                      ) : (
                        <button
                          onClick={() => onJoin(game)}
                          className="px-4 py-1 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                          title="Join this game"
                        >
                          Join
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
