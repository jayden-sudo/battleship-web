"use client";

interface OngoingGameProps {
  gameId: string | null;
  onForceQuit: () => void;
  onRefresh: () => void;
  isLoading?: boolean;
  isQuitting?: boolean;
}

export function OngoingGame({
  gameId,
  onForceQuit,
  onRefresh,
  isLoading,
  isQuitting,
}: OngoingGameProps) {
  const formatGameId = (id: string) => {
    return `${id.slice(0, 10)}...${id.slice(-8)}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-black text-white flex items-center gap-2">
          <span className="text-2xl">⚔️</span>
          Ongoing Game
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
            <tr className="bg-gradient-to-r from-orange-500 to-red-500 text-white border-b-4 border-orange-600">
              <th className="px-4 py-3 text-left font-black">🎲 Game ID</th>
              <th className="px-4 py-3 text-center font-black">⚡ Action</th>
            </tr>
          </thead>
          <tbody>
            {!gameId ? (
              <tr>
                <td colSpan={2} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-6xl animate-bounce">✨</span>
                    <p className="text-gray-600 font-bold text-lg">
                      No ongoing game
                    </p>
                    <p className="text-gray-500">
                      Join or create a game to start!
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              <tr className="border-b border-orange-200 hover:bg-gradient-to-r hover:from-orange-50 hover:to-red-50 transition-all animate-fade-in-up">
                <td className="px-4 py-4 font-mono font-bold text-orange-700">
                  {formatGameId(gameId)}
                </td>
                <td className="px-4 py-4 text-center">
                  <button
                    onClick={onForceQuit}
                    disabled={isQuitting}
                    className="px-5 py-2 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white font-bold rounded-lg shadow-lg hover:shadow-xl hover:scale-110 transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Force quit this game"
                  >
                    {isQuitting ? "⏳ Quitting..." : "💥 Force Quit"}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
