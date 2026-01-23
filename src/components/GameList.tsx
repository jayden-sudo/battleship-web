"use client";

import { GameData } from "@/utils/interfaces";
import { ethers } from "ethers";
import { USE_P2P, USE_PARTYKIT } from "@/utils/gameManager";

interface GameListProps {
  games: GameData[];
  onJoin: (game: GameData) => void;
  onQuit: (game: GameData) => void;
  onRefresh: () => void;
  isLoading?: boolean;
  currentUserAddress?: string;
}

export function GameList({
  games,
  onJoin,
  onQuit,
  onRefresh,
  isLoading,
  currentUserAddress,
}: GameListProps) {
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatTimestamp = (timestamp: bigint) => {
    const date = new Date(Number(timestamp) * 1000);
    return date.toLocaleString();
  };

  const formatStake = (stake: bigint) => {
    return ethers.formatEther(stake);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-black text-white flex items-center gap-2">
          <span className="text-2xl">🎮</span>
          Available Games
        </h3>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="px-4 py-2 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-500 hover:to-blue-600 text-white font-bold rounded-lg shadow-lg hover:shadow-xl hover:scale-105 transition-all transform active:scale-95 disabled:opacity-50"
        >
          {isLoading ? "🔄 Refreshing..." : "🔄 Refresh"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl shadow-2xl">
        <table className="w-full text-sm bg-white bg-opacity-90 backdrop-blur-sm">
          <thead>
            <tr className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-b-4 border-purple-600">
              <th className="px-4 py-3 text-left font-black">👤 Creator</th>
              <th className="px-4 py-3 text-left font-black">⏰ Created</th>
              <th className="px-4 py-3 text-right font-black">💰 Stake (ETH)</th>
              <th className="px-4 py-3 text-center font-black">🎯 Action</th>
            </tr>
          </thead>
          <tbody>
            {games.length === 0 ? (
              <tr>
                <td
                  colSpan={USE_PARTYKIT ? 5 : 4}
                  className="px-4 py-12 text-center"
                >
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-6xl animate-bounce">🎲</span>
                    <p className="text-gray-600 font-bold text-lg">
                      No games available
                    </p>
                    <p className="text-gray-500">
                      Create a new game to start playing!
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              games.map((game, index) => {
                // Check if current user is the creator (case-insensitive comparison)
                const isOwnGame = !!(
                  currentUserAddress &&
                  game.creator.toLowerCase() ===
                    currentUserAddress.toLowerCase()
                );

                return (
                  <tr 
                    key={index} 
                    className="border-b border-purple-200 hover:bg-gradient-to-r hover:from-purple-50 hover:to-pink-50 transition-all animate-fade-in-up"
                    style={{ animationDelay: `${index * 0.1}s` }}
                  >
                    <td className="px-4 py-4 font-mono font-bold text-purple-700">
                      {formatAddress(game.creator)}
                    </td>
                    <td className="px-4 py-4 text-gray-700 font-semibold">
                      {formatTimestamp(game.lastActiveTimestamp)}
                    </td>
                    <td className="px-4 py-4 text-right font-black text-green-600 text-lg">
                      {formatStake(game.stake)}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {isOwnGame ? (
                        <button
                          onClick={() => onQuit(game)}
                          className="px-5 py-2 bg-gradient-to-r from-red-400 to-pink-500 hover:from-red-500 hover:to-pink-600 text-white font-bold rounded-lg shadow-lg hover:shadow-xl hover:scale-110 transition-all transform active:scale-95"
                          title="Close your game"
                        >
                          ❌ Quit
                        </button>
                      ) : (
                        <button
                          onClick={() => onJoin(game)}
                          className="px-5 py-2 bg-gradient-to-r from-green-400 to-emerald-500 hover:from-green-500 hover:to-emerald-600 text-white font-bold rounded-lg shadow-lg hover:shadow-xl hover:scale-110 transition-all transform active:scale-95 animate-pulse"
                          title="Join this game"
                        >
                          🚀 Join
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
