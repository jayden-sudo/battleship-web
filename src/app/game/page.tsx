'use client'

import { NetworkGuard } from '@/components/NetworkGuard'
import { GameBoardComponent } from '@/components/GameBoard'
import { CreateGameModal } from '@/components/CreateGameModal'
import { GameList } from '@/components/GameList'
import { OngoingGame } from '@/components/OngoingGame'
import { LoadingModal } from '@/components/LoadingModal'
import { GameEndModal } from '@/components/GameEndModal'
import { useAccount, useWalletClient, useConfig } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useEffect, useState, useRef } from 'react'
import { ethers, BrowserProvider } from 'ethers'
import { GameBoard as GameBoardClass } from '@/utils/gameBoard'
import { Contract } from '@/utils/contract'
import { GameData, DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES, UserBalance, NextTurnState, BYTES32_0, GameViewStatus } from '@/utils/interfaces'
import { GameManager,USE_P2P,USE_PARTYKIT } from '@/utils/gameManager'
import { getProviderAndSigner } from '@/utils/provider'
import { PartykitManager } from '@/utils/partykitManager'

export default function GamePage() {
  const [mounted, setMounted] = useState(false)
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const wagmiConfig = useConfig()
  
  // Game state
  const [isInGame, setIsInGame] = useState(false)
  const [myBoard, setMyBoard] = useState<GameBoardClass | null>(null)
  const [enemyBoard, setEnemyBoard] = useState<GameBoardClass | null>(null)
  const [currentGameData, setCurrentGameData] = useState<GameData | null>(null)
  const [canShoot, setCanShoot] = useState(false)
  const [gameViewStatus, setGameViewStatus] = useState<{ status: string; isMyTurn: boolean }>({ status: '', isMyTurn: false })
  const [autoShoot, setAutoShoot] = useState(false)
  
  // UI state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [availableGames, setAvailableGames] = useState<{games:GameData[],aliveGameId:Set<string>}>({games:[], aliveGameId:new Set()})
  const [isLoadingGames, setIsLoadingGames] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string>('')
  
  // Balance state
  const [userBalance, setUserBalance] = useState<UserBalance | null>(null)
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [withdrawAmount, setWithdrawAmount] = useState<string>('')
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  
  // Ongoing game state
  const [ongoingGameId, setOngoingGameId] = useState<string | null>(null)
  const [isLoadingOngoingGame, setIsLoadingOngoingGame] = useState(false)
  const [isQuittingOngoingGame, setIsQuittingOngoingGame] = useState(false)
  
  // Loading modal state
  const [loadingModal, setLoadingModal] = useState<{ isOpen: boolean; message: string }>({ isOpen: false, message: '' })
  
  // Game end modal state
  const [gameEndModal, setGameEndModal] = useState<{ isOpen: boolean; isWinner: boolean }>({ isOpen: false, isWinner: false })
  
  // Game manager reference
  const gameManagerRef = useRef<GameManager | null>(null)

  useEffect(() => {
    setMounted(true)
    
    // Initialize boards
    const board = new GameBoardClass(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)
    setMyBoard(board)
    
    const enemy = new GameBoardClass(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)
    setEnemyBoard(enemy)
  }, [])

  useEffect(() => {
    if (mounted && address && walletClient) {
      initializeNetWork()
      loadAvailableGames()
      loadUserBalance()
      loadOngoingGame()
    }
  }, [mounted, address, walletClient])

  // Initialize when wallet address is available
  const initializeNetWork = async () => {
    if (!address) return
    
    // try {
    //   const pm = PlayroomKitManager.getInstance()
    //   await pm.initialize()
    //   pm.setPlayerInfo(address, address)
    //   console.log('[PlayroomKit] Initialized for address:', address)
    // } catch (error) {
    //   console.error('[PlayroomKit] Failed to initialize:', error)
    //   // Not critical - game can still function without PlayroomKit
    // }
  }

 

  const loadUserBalance = async () => {
    if (!address || !walletClient) return
    
    try {
      // Use wagmi's walletClient which is EIP-6963 compatible
      const { provider, signer } = await getProviderAndSigner(walletClient)
      const contract = new Contract(provider, signer)
      
      const balance = await contract.getUserBalance(address)
      setUserBalance(balance)
    } catch (error) {
      console.error('Failed to load user balance:', error)
    }
  }

  const loadOngoingGame = async () => {
    if (!address || !walletClient) return
    
    setIsLoadingOngoingGame(true)
    try {
      const { provider, signer } = await getProviderAndSigner(walletClient)
      const contract = new Contract(provider, signer)
      
      const gameId = await contract.getUserGameId(address)
      if (gameId !== BYTES32_0) {
        setOngoingGameId(gameId)
      } else {
        setOngoingGameId(null)
      }
    } catch (error) {
      console.error('Failed to load ongoing game:', error)
      setOngoingGameId(null)
    } finally {
      setIsLoadingOngoingGame(false)
    }
  }

  const handleForceQuitOngoingGame = async () => {
    if (!address || !walletClient || !ongoingGameId) return
    
    try {
      setIsQuittingOngoingGame(true)
      setStatusMessage('Force quitting game...')
      
      const { provider, signer } = await getProviderAndSigner(walletClient)
      const contract = new Contract(provider, signer)
      
      // Get game data to check state
      const gameData = await contract.getGameData(ongoingGameId)
      
      // If game is in Join state (waiting for opponent), close idle game
      if (gameData.nextTurnState === NextTurnState.Join) {
        setLoadingModal({ isOpen: true, message: 'Closing game on blockchain...' })
        try {
          await contract.closeIdleGame(ongoingGameId)
        } finally {
          setLoadingModal({ isOpen: false, message: '' })
        }
        setStatusMessage('Game closed successfully')
      } else {
        // Try opponentLeave first
        let opponentLeft = false
        try {
          setLoadingModal({ isOpen: true, message: 'Leaving game...' })
          if (await contract.opponentLeave(ongoingGameId)) {
            opponentLeft = true
            setStatusMessage('Left game successfully')
          }
        } catch (error) {
          console.error('opponentLeave failed:', error)
        } finally {
          setLoadingModal({ isOpen: false, message: '' })
        }
        if (opponentLeft === false) {
          try {
            // If opponentLeave fails, surrender
            setLoadingModal({ isOpen: true, message: 'Surrendering game...' })
            await contract.surrender(ongoingGameId)
            setStatusMessage('Surrendered successfully')
          } catch (error) {
            console.error('Surrender failed:', error)
          } finally {
            setLoadingModal({ isOpen: false, message: '' })
          }
        }
      }
      
      // Verify game is closed
      const newGameId = await contract.getUserGameId(address)
      if (newGameId !== BYTES32_0) {
        throw new Error('Failed to terminate game')
      }
      
      // Refresh data
      await loadOngoingGame()
      await loadAvailableGames()
      await loadUserBalance()
      
    } catch (error) {
      console.error('Failed to force quit game:', error)
      setStatusMessage(`Failed to force quit game: ${(error as Error).message}`)
      alert(`Failed to force quit game: ${(error as Error).message}`)
    } finally {
      setIsQuittingOngoingGame(false)
    }
  }

  const initializeGameManager = async (): Promise<GameManager> => {
    if (walletClient && myBoard) {
      // Use wagmi's walletClient which is EIP-6963 compatible
      const { provider, signer } = await getProviderAndSigner(walletClient)
      
      const gameManager = new GameManager(provider, signer, address!, myBoard, {
        onGameDataUpdate: (gameData) => {
          setCurrentGameData(gameData)
          setStatusMessage(`Game updated: ${gameData.gameId.slice(0, 10)}...`)
        },
        onMyBoardUpdate: (board) => {
          setMyBoard(board)
        },
        onEnemyBoardUpdate: (board) => {
          setEnemyBoard(board)
        },
        onGameStateChange: (inGame) => {
          setIsInGame(inGame)
          if (!inGame) setCanShoot(false)
        },
        onShootEnabled: (enabled) => {
          setCanShoot(enabled)
        },
        onLoadingChange: (loading, message) => {
          setLoadingModal({ isOpen: loading, message })
        },
        onGameEnd: (isWinner) => {
          setGameEndModal({ isOpen: true, isWinner })
        },
        onGameViewStatusChange: (status, isMyTurn) => {
          setGameViewStatus({ status, isMyTurn })
        },
        onMessage: (message) => {
          setStatusMessage(message)
          console.log('[Game]', message)
        },
        onError: (error) => {
          setStatusMessage(`Error: ${error}`)
          console.error('[Game]', error)
        }
      })
      
      // Check if auto-shoot was enabled in previous game
      const isAutoShootEnabled = gameManager.getAutoShoot()
      setAutoShoot(isAutoShootEnabled)
      
      return gameManager
    }
    throw new Error('Ethereum provider not found')
  }

  const loadAvailableGames = async () => {
    setIsLoadingGames(true)
    try {
      if (walletClient) {
        // Use wagmi's walletClient which is EIP-6963 compatible
        const { provider, signer } = await getProviderAndSigner(walletClient)
        const contractInstance = new Contract(provider, signer)
        const games = await contractInstance.listWaitingGameData()
        if(USE_PARTYKIT){
          const aliveGameId = await PartykitManager.getInstance().getActiveGames();
          setAvailableGames({games:games,aliveGameId:aliveGameId})
        }
        if(USE_P2P){
          setAvailableGames({games:games,aliveGameId:new Set()})
        }
        setStatusMessage(`Found ${games.length} available games`)
      }
    } catch (error) {
      console.error('Failed to load games:', error)
      setStatusMessage(`Failed to load games: ${(error as Error).message}`)
    } finally {
      setIsLoadingGames(false)
    }
  }

  const handleRandomizeBoard = () => {
    if (myBoard && !isInGame) {
      myBoard.initRandom()
      // Force re-render by creating new instance with same data
      const newBoard = new GameBoardClass(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)
      newBoard.pos = [...myBoard.pos]
      newBoard.ships = myBoard.ships.map(s => [...s])
      setMyBoard(newBoard)
      setStatusMessage('Board randomized')
    }
  }

  const handleShoot = (position: number) => {
    if (gameManagerRef.current && canShoot) {
      gameManagerRef.current.shoot(position)
    }
  }

  const handleAutoShootToggle = () => {
    if (!gameManagerRef.current) return
    const newAutoShoot = !autoShoot
    setAutoShoot(newAutoShoot)
    gameManagerRef.current.enableAutoShoot(newAutoShoot)
  }

  const handleCreateGame = async (stakeAmount: string) => {
    if (!address) return
    
    try {
      setStatusMessage('Creating game...')
      setShowCreateModal(false)
      
      const stake = ethers.parseEther(stakeAmount)
      
      // Always create new game manager with proper callbacks for the game
      const gameManager = await initializeGameManager()
      gameManagerRef.current = gameManager
      
      // Set the current board to game manager
      if (myBoard) {
        gameManager.gridMe.pos = [...myBoard.pos]
        gameManager.gridMe.ships = myBoard.ships.map(s => [...s])
      }

      gameManager.initCreatorGameSalt();
      // preCreateGame
      const gameId = await gameManager.preCreateGame(stake, true);
      
      let iframe;
      if(USE_P2P){
        // Create a hidden iframe for P2P test
        iframe = document.createElement('iframe');
        iframe.src = `/p2p_test?roomid=${gameId}`;
        iframe.style.display = 'block';
        iframe.style.position = 'absolute';
        iframe.style.top='-1';
        iframe.style.left='-1';
        iframe.style.width = '1';
        iframe.style.height = '1';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);
      }
      // Create game
      let _re;
      try {
        _re= await gameManager.createGame(stake,gameId)
      } finally{
        if(USE_P2P){
          // Remove
          if (iframe && iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
        }
      }
      if(_re==='networkerror'){
        if(USE_P2P){
          alert('P2P network connection failed. Please check your network or try again later.')
        }
        if(USE_PARTYKIT){
          alert('network connection failed. Please check your network or try again later.')
        }
      } else if(_re==='error'){
        alert('Failed to create game. Please try again later.')
      } else if(_re==='success'){
        setStatusMessage('Game created! Waiting for opponent...')
      }
      
    } catch (error) {
      console.error('Failed to create game:', error)
      setStatusMessage(`Failed to create game: ${(error as Error).message}`)
      alert(`Failed to create game: ${(error as Error).message}`)
    }
  }

  const handleJoinGame = async (game: GameData) => {
    if (!address) return
    
    try {
      setStatusMessage('Joining game...')
      
      // Always create new game manager with proper callbacks for the game
      const gameManager = await initializeGameManager()
      gameManagerRef.current = gameManager
      
      // Set the current board to game manager
      if (myBoard) {
        gameManager.gridMe.pos = [...myBoard.pos]
        gameManager.gridMe.ships = myBoard.ships.map(s => [...s])
      }
      
      // Join game
      await gameManager.joinGame(game)
      
      setStatusMessage('Joined game successfully!')
      
    } catch (error) {
      console.error('Failed to join game:', error)
      setStatusMessage(`Failed to join game: ${(error as Error).message}`)
      alert(`Failed to join game: ${(error as Error).message}`)
    }
  }

  const handleQuitGame = async (game: GameData) => {
    if (!address || !walletClient) return
    
    try {
      setStatusMessage('Closing game...')
      
      // Use wagmi's walletClient which is EIP-6963 compatible
      const { provider, signer } = await getProviderAndSigner(walletClient)
      const contract = new Contract(provider, signer)
      
      // Get user's current game ID
      const gameId = await contract.getUserGameId(address)
      
      if (gameId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        setStatusMessage('No active game found')
        return
      }
      
      // Get game data to check state
      const gameData = await contract.getGameData(gameId)
      
      // If game is in Join state (waiting for opponent), close idle game
      if (gameData.nextTurnState === NextTurnState.Join) {
        await contract.closeIdleGame(gameId)
        setStatusMessage('Game closed successfully')
      } else {
        // Try opponentLeave first
        let opponentLeft = false
        try {
          if(await contract.opponentLeave(gameId)){
            opponentLeft = true;
            setStatusMessage('Left game successfully')
          }
        } catch (error) {
          console.error('opponentLeave failed:', error)
        }
        if(opponentLeft === false){
          try {
            // If opponentLeave fails, surrender
            await contract.surrender(gameId)
            setStatusMessage('Surrendered successfully')
          } catch (error) {
            console.error('Surrender failed:', error)
          }
        }
      }
      
      // Verify game is closed
      const newGameId = await contract.getUserGameId(address)
      if (newGameId !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
        throw new Error('Failed to terminate game')
      }
      
      // Refresh games list and balance
      await loadAvailableGames()
      await loadUserBalance()
      
    } catch (error) {
      console.error('Failed to quit game:', error)
      setStatusMessage(`Failed to quit game: ${(error as Error).message}`)
      alert(`Failed to quit game: ${(error as Error).message}`)
    }
  }

  const handleWithdraw = async () => {
    if (!address || !userBalance || !withdrawAmount) return
    
    try {
      const amount = ethers.parseEther(withdrawAmount)
      const availableBalance = userBalance.totalBalance - userBalance.lockedBalance
      
      // Validate amount
      if (amount <= BigInt(0)) {
        alert('Withdrawal amount must be greater than 0')
        return
      }
      
      if (amount > availableBalance) {
        alert(`Cannot withdraw more than available balance: ${ethers.formatEther(availableBalance)} ETH`)
        return
      }
      
      setIsWithdrawing(true)
      setStatusMessage('Processing withdrawal...')
      
      // Use wagmi's walletClient which is EIP-6963 compatible
      if (!walletClient) {
        throw new Error('Wallet not connected')
      }
      const { provider, signer } = await getProviderAndSigner(walletClient)
      const contract = new Contract(provider, signer)
      
      setLoadingModal({ isOpen: true, message: 'Processing withdrawal...' })
      try {
        await contract.withdraw(amount)
      } finally {
        setLoadingModal({ isOpen: false, message: '' })
      }
      
      setStatusMessage('Withdrawal successful!')
      setShowWithdrawModal(false)
      setWithdrawAmount('')
      
      // Refresh balance
      await loadUserBalance()
      
    } catch (error) {
      console.error('Failed to withdraw:', error)
      setStatusMessage(`Withdrawal failed: ${(error as Error).message}`)
      alert(`Withdrawal failed: ${(error as Error).message}`)
    } finally {
      setIsWithdrawing(false)
    }
  }

  const handleMaxWithdraw = () => {
    if (userBalance) {
      const availableBalance = userBalance.totalBalance - userBalance.lockedBalance
      setWithdrawAmount(ethers.formatEther(availableBalance))
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gameManagerRef.current) {
        gameManagerRef.current.stopGame()
      }
    }
  }, [])

  // Wait for client-side mounting
  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  return (
    <NetworkGuard>
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900">
        {/* Header */}
        <header className="bg-blue-950 bg-opacity-80 backdrop-blur-md shadow-lg">
          <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-white">⚓ Battleship</h1>
              <span className="text-sm text-blue-200">
                6×6 ZK Blockchain Game
              </span>
            </div>
            
            {/* Balance Display */}
            {userBalance && address && (
              <div className="flex items-center gap-4 bg-blue-900 bg-opacity-50 px-4 py-2 rounded-lg">
                <div className="text-white text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-200">Total:</span>
                    <span className="font-bold">{ethers.formatEther(userBalance.totalBalance)} ETH</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-blue-200">Locked:</span>
                    <span className="font-semibold">{ethers.formatEther(userBalance.lockedBalance)} ETH</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowWithdrawModal(true)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  💰 Withdraw
                </button>
              </div>
            )}
            
            <ConnectButton 
              showBalance={false}
              chainStatus="icon"
              accountStatus="address"
            />
          </div>
        </header>

        {/* Status Bar */}
        {statusMessage && (
          <div className="bg-blue-600 bg-opacity-50 backdrop-blur-sm">
            <div className="max-w-7xl mx-auto px-4 py-2">
              <p className="text-white text-sm">{statusMessage}</p>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 py-8">
          {!isInGame ? (
            /* Not in game - Show lobby */
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left: My Board */}
              <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl shadow-2xl p-6">
                <h2 className="text-2xl font-bold text-white mb-4">My Board</h2>
                <div className="flex flex-col items-center space-y-4">
                  {myBoard && <GameBoardComponent board={myBoard} />}
                  <button
                    onClick={handleRandomizeBoard}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    🎲 Random Generate Board
                  </button>
                </div>
              </div>

              {/* Right: Function Area */}
              <div className="space-y-6">
                {/* Create Game Button */}
                <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl shadow-2xl p-6">
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="w-full py-4 bg-green-600 hover:bg-green-700 text-white text-xl font-bold rounded-lg transition-colors"
                  >
                    ➕ Create New Game
                  </button>
                </div>

                {/* Ongoing Game */}
                <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl shadow-2xl p-6">
                  <OngoingGame
                    gameId={ongoingGameId}
                    onForceQuit={handleForceQuitOngoingGame}
                    onRefresh={loadOngoingGame}
                    isLoading={isLoadingOngoingGame}
                    isQuitting={isQuittingOngoingGame}
                  />
                </div>

                {/* Available Games List */}
                <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl shadow-2xl p-6">
                  <GameList
                    games={availableGames}
                    onJoin={handleJoinGame}
                    onQuit={handleQuitGame}
                    onRefresh={loadAvailableGames}
                    isLoading={isLoadingGames}
                    currentUserAddress={address}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* In game - Show both boards */
            <div className="space-y-6">
              {/* Game Info */}
              {currentGameData && (
                <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl shadow-2xl p-4">
                  <div className="grid grid-cols-4 gap-4 text-sm items-center">
                    <div>
                      <span className="text-blue-500 font-medium">Game ID:</span>{' '}
                      <span className="font-mono text-yellow-600">{currentGameData.gameId.slice(0, 10)}...</span>
                    </div>
                    <div>
                      <span className="text-blue-500 font-medium">Stake:</span>{' '}
                      <span className="font-bold text-green-600">{ethers.formatEther(currentGameData.stake)} ETH</span>
                    </div>
                    <div>
                      <span className="text-blue-500 font-medium">Turn:</span>{' '}
                      <span className={`font-bold ${gameViewStatus.isMyTurn ? 'text-green-400' : 'text-cyan-600'}`}>
                        {gameViewStatus.isMyTurn ? '🎯 Your Turn' : '⏳ Enemy\'s Turn'}
                        {/* {gameViewStatus.status} */}
                      </span>
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        onClick={handleAutoShootToggle}
                        className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                          autoShoot 
                            ? 'bg-green-600 hover:bg-green-700 text-white' 
                            : 'bg-gray-600 hover:bg-gray-700 text-gray-200'
                        }`}
                        title={autoShoot ? 'Auto-shoot enabled' : 'Auto-shoot disabled'}
                      >
                        {autoShoot ? '🤖 Auto' : '👆 Manual'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Boards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left: My Board */}
                <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl shadow-2xl p-6">
                  <h2 className="text-2xl font-bold text-white mb-4">My Board</h2>
                  <div className="flex justify-center">
                    {myBoard && <GameBoardComponent board={myBoard} />}
                  </div>
                </div>

                {/* Right: Enemy Board */}
                <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl shadow-2xl p-6">
                  <h2 className="text-2xl font-bold text-white mb-4">Enemy Board</h2>
                  <div className="flex justify-center">
                    {enemyBoard && (
                      <GameBoardComponent 
                        board={enemyBoard} 
                        isEnemy={true}
                        canShoot={canShoot}
                        onShoot={handleShoot}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Create Game Modal */}
        <CreateGameModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateGame}
        />

        {/* Withdraw Modal */}
        {showWithdrawModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-blue-900 to-indigo-900 rounded-2xl shadow-2xl p-8 max-w-md w-full border-2 border-blue-400">
              <h2 className="text-2xl font-bold text-white mb-6">💰 Withdraw Funds</h2>
              
              {userBalance && (
                <div className="mb-6 space-y-2">
                  <div className="flex justify-between text-white">
                    <span className="text-blue-200">Total Balance:</span>
                    <span className="font-bold">{ethers.formatEther(userBalance.totalBalance)} ETH</span>
                  </div>
                  <div className="flex justify-between text-white">
                    <span className="text-blue-200">Locked Balance:</span>
                    <span className="font-semibold">{ethers.formatEther(userBalance.lockedBalance)} ETH</span>
                  </div>
                  <div className="flex justify-between text-white border-t border-blue-400 pt-2">
                    <span className="text-green-300">Available:</span>
                    <span className="font-bold text-green-300">
                      {ethers.formatEther(userBalance.totalBalance - userBalance.lockedBalance)} ETH
                    </span>
                  </div>
                </div>
              )}
              
              <div className="mb-6">
                <label className="block text-blue-200 text-sm font-medium mb-2">
                  Withdrawal Amount (ETH)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 bg-blue-950 bg-opacity-50 text-white px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    disabled={isWithdrawing}
                  />
                  <button
                    onClick={handleMaxWithdraw}
                    className="px-4 py-3 bg-blue-700 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50"
                    disabled={isWithdrawing}
                  >
                    MAX
                  </button>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowWithdrawModal(false)
                    setWithdrawAmount('')
                  }}
                  className="flex-1 px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
                  disabled={isWithdrawing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleWithdraw}
                  className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
                  disabled={isWithdrawing || !withdrawAmount}
                >
                  {isWithdrawing ? 'Processing...' : 'Withdraw'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading Modal */}
        <LoadingModal
          isOpen={loadingModal.isOpen}
          message={loadingModal.message}
          canClose={false}
        />

        {/* Game End Modal */}
        <GameEndModal
          isOpen={gameEndModal.isOpen}
          isWinner={gameEndModal.isWinner}
          onClose={async () => {
            setGameEndModal({ isOpen: false, isWinner: false })
            // Stop the game after animation
            if (gameManagerRef.current) {
              await gameManagerRef.current.stopGame()
              gameManagerRef.current = null
            }
            // Reset boards to clean state
            const newMyBoard = new GameBoardClass(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)
            newMyBoard.initRandom() // Initialize with random ship placement
            setMyBoard(newMyBoard)
            
            const newEnemyBoard = new GameBoardClass(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)
            setEnemyBoard(newEnemyBoard)
            
            // Reset shoot state
            setCanShoot(false)
            setCurrentGameData(null)
            setGameViewStatus({ status: '', isMyTurn: false })
            // Note: auto-shoot state persists across games as requested
            
            // Refresh data
            await loadOngoingGame()
            await loadAvailableGames()
            await loadUserBalance()
          }}
        />
      </div>
    </NetworkGuard>
  )
}
