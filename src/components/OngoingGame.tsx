'use client'

interface OngoingGameProps {
  gameId: string | null
  onForceQuit: () => void
  onRefresh: () => void
  isLoading?: boolean
  isQuitting?: boolean
}

export function OngoingGame({ gameId, onForceQuit, onRefresh, isLoading, isQuitting }: OngoingGameProps) {
  const formatGameId = (id: string) => {
    return `${id.slice(0, 10)}...${id.slice(-8)}`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Ongoing Game</h3>
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
              <th className="px-4 py-2 text-left">Game ID</th>
              <th className="px-4 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {!gameId ? (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-gray-500">
                  No ongoing game
                </td>
              </tr>
            ) : (
              <tr className="border-b hover:bg-gray-50">
                <td className="px-4 py-3 font-mono">
                  {formatGameId(gameId)}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={onForceQuit}
                    disabled={isQuitting}
                    className="px-4 py-1 bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50"
                    title="Force quit this game"
                  >
                    {isQuitting ? 'Quitting...' : 'Force Quit'}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
