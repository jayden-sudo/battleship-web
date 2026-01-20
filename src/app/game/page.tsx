"use client";

import { NetworkGuard } from "@/components/NetworkGuard";
import { GameBoardComponent } from "@/components/GameBoard";
import { CreateGameModal } from "@/components/CreateGameModal";
import { GameList } from "@/components/GameList";
import { OngoingGame } from "@/components/OngoingGame";
import { LoadingModal } from "@/components/LoadingModal";
import { GameEndModal } from "@/components/GameEndModal";
import { useAccount, useWalletClient, useConfig } from "wagmi";
import { getConnections, getCapabilities } from "@wagmi/core";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState, useRef } from "react";
import { ethers } from "ethers";
import { GameBoard, GameBoard as GameBoardClass } from "@/utils/gameBoard";
import { Contract } from "@/utils/contract";
import {
  GameData,
  DEFAULT_GRID_SIZE,
  DEFAULT_SHIP_SIZES,
  UserBalance,
  NextTurnState,
  BYTES32_0,
} from "@/utils/interfaces";
import { GameManager, USE_P2P, USE_PARTYKIT } from "@/utils/gameManager";
import { getProviderAndSigner } from "@/utils/provider";
import { PartykitManager } from "@/utils/partykitManager";

export default function GamePage() {
  const [mounted, setMounted] = useState(false);
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const wagmiConfig = useConfig();

  // Game state
  const [isInGame, setIsInGame] = useState(false);
  const [myBoard, setMyBoard] = useState<GameBoardClass | null>(null);
  const [enemyBoard, setEnemyBoard] = useState<GameBoardClass | null>(null);
  const [myBoardVersion, setMyBoardVersion] = useState(0);
  const [enemyBoardVersion, setEnemyBoardVersion] = useState(0);

  const [currentGameData, setCurrentGameData] = useState<GameData | null>(null);
  const [canShoot, setCanShoot] = useState(false);
  const [gameViewStatus, setGameViewStatus] = useState<{
    status: string;
    isMyTurn: boolean;
    isTx: boolean;
  }>({ status: "Waiting", isMyTurn: true, isTx: false });
  const [autoShoot, setAutoShoot] = useState(false);

  // UI state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [availableGames, setAvailableGames] = useState<GameData[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  // Balance state
  const [userBalance, setUserBalance] = useState<UserBalance | null>(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  // Ongoing game state
  const [ongoingGameId, setOngoingGameId] = useState<string | null>(null);
  const [isLoadingOngoingGame, setIsLoadingOngoingGame] = useState(false);
  const [isQuittingOngoingGame, setIsQuittingOngoingGame] = useState(false);

  // Loading modal state
  const [loadingModal, setLoadingModal] = useState<{
    isOpen: boolean;
    message: string;
  }>({ isOpen: false, message: "" });

  // Game end modal state
  const [gameEndModal, setGameEndModal] = useState<{
    isOpen: boolean;
    isWinner: boolean;
  }>({ isOpen: false, isWinner: false });

  // Transaction confirmation modal state
  const [showTxConfirmModal, setShowTxConfirmModal] = useState(false);
  const txConfirmTimerRef = useRef<NodeJS.Timeout | null>(null);

  // EIP-5792 atomic batch support
  const [supportsAtomicBatch, setSupportsAtomicBatch] = useState(false);

  // Game manager reference
  const gameManagerRef = useRef<GameManager | null>(null);

  useEffect(() => {
    setMounted(true);

    // Initialize boards
    const board = new GameBoardClass(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES);
    board.initRandom();
    setMyBoard(board);

    const enemy = new GameBoardClass(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES);
    setEnemyBoard(enemy);
  }, []);

  useEffect(() => {
    if (mounted && address && walletClient) {
      initializeNetWork();
      loadAvailableGames();
      loadUserBalance();
      loadOngoingGame();
    }
  }, [mounted, address, walletClient]);

  // Check wallet capabilities for EIP-5792 atomic batch support
  const checkWalletCapabilities = async () => {
    try {
      const connections = getConnections(wagmiConfig);
      if (connections.length === 0) {
        console.log("[EIP-5792] No wallet connected");
        setSupportsAtomicBatch(false);
        return;
      }

      const capabilities = await getCapabilities(wagmiConfig);
      console.log("[EIP-5792] Wallet capabilities:", capabilities);

      // Check if any connected chain supports atomic batch
      let hasAtomicBatch = false;
      for (const chainId in capabilities) {
        const chainCapabilities = capabilities[chainId];
        if (
          chainCapabilities?.atomic?.status === "supported" ||
          chainCapabilities?.atomic?.status === "ready"
        ) {
          hasAtomicBatch = true;
          console.log(`[EIP-5792] Chain ${chainId} supports atomic batch`);
          break;
        }
      }

      setSupportsAtomicBatch(hasAtomicBatch);
      console.log("[EIP-5792] Atomic batch support:", hasAtomicBatch);
    } catch (error) {
      console.error("[EIP-5792] Failed to check capabilities:", error);
      setSupportsAtomicBatch(false);
    }
  };

  // Initialize when wallet address is available
  const initializeNetWork = async () => {
    if (!address) return;

    // Check EIP-5792 capabilities
    await checkWalletCapabilities();

    // try {
    //   const pm = PlayroomKitManager.getInstance()
    //   await pm.initialize()
    //   pm.setPlayerInfo(address, address)
    //   console.log('[PlayroomKit] Initialized for address:', address)
    // } catch (error) {
    //   console.error('[PlayroomKit] Failed to initialize:', error)
    //   // Not critical - game can still function without PlayroomKit
    // }
  };

  const loadUserBalance = async () => {
    if (!address || !walletClient) return;

    try {
      // Use wagmi's walletClient which is EIP-6963 compatible
      const { provider, signer } = await getProviderAndSigner(walletClient);
      const contract = new Contract(
        provider,
        signer,
        wagmiConfig,
        supportsAtomicBatch,
      );

      const balance = await contract.getUserBalance(address);
      setUserBalance(balance);
    } catch (error) {
      console.error("Failed to load user balance:", error);
    }
  };

  const loadOngoingGame = async () => {
    if (!address || !walletClient) return;

    setIsLoadingOngoingGame(true);
    try {
      const { provider, signer } = await getProviderAndSigner(walletClient);
      const contract = new Contract(
        provider,
        signer,
        wagmiConfig,
        supportsAtomicBatch,
      );

      const gameId = await contract.getUserGameId(address);
      if (gameId !== BYTES32_0) {
        //setOngoingGameId(gameId)
        // Check for saved state and try fallback resumption
        await resumeOngoingGame(gameId, contract);
      } else {
        setOngoingGameId(null);
      }
    } catch (error) {
      console.error("Failed to load ongoing game:", error);
      setOngoingGameId(null);
    } finally {
      setIsLoadingOngoingGame(false);
    }
  };

  const resumeOngoingGame = async (gameId: string, contract: Contract) => {
    if (!address) return;
    const savedState = GameManager.loadState(gameId, address);
    if (!savedState) {
      console.log("No local state found for game", gameId);
      setOngoingGameId(gameId);
      return;
    }

    try {
      setStatusMessage("Resuming game session...");
      // Reconstruct board
      const board = new GameBoardClass(
        DEFAULT_GRID_SIZE,
        DEFAULT_SHIP_SIZES,
        savedState.pos,
        savedState.ships,
      );
      setMyBoard(board);

      // Initialize Manager
      const gameManager = await initializeGameManager(board);
      gameManagerRef.current = gameManager;

      // Restore Keys
      gameManager.restoreState(savedState);

      // Get GameData
      const gameData = await contract.getGameData(gameId);

      // Resume
      await gameManager.resumeGame(gameData);

      setOngoingGameId(gameId);
      setIsInGame(true);
      setStatusMessage("Game resumed successfully");
    } catch (error) {
      console.error("Failed to resume game:", error);
      setStatusMessage("Failed to resume game session");
      setOngoingGameId(gameId); // Fallback to force quit UI
    }
  };

  const handleForceQuitOngoingGame = async (gameIdOverride?: string) => {
    let targetGameId = ongoingGameId;
    if (typeof gameIdOverride === "string") {
      targetGameId = gameIdOverride;
    }
    if (!address || !walletClient || !targetGameId) return;

    try {
      setIsQuittingOngoingGame(true);
      setStatusMessage("Force quitting game...");

      const { provider, signer } = await getProviderAndSigner(walletClient);
      const contract = new Contract(
        provider,
        signer,
        wagmiConfig,
        supportsAtomicBatch,
      );

      // Get game data to check state
      const gameData = await contract.getGameData(targetGameId);

      // If game is in Join state (waiting for opponent), close idle game
      if (gameData.nextTurnState === NextTurnState.Join) {
        setLoadingModal({
          isOpen: true,
          message: "Closing game on blockchain...",
        });
        try {
          await contract.closeIdleGame(targetGameId);
        } finally {
          setLoadingModal({ isOpen: false, message: "" });
        }
        setStatusMessage("Game closed successfully");
      } else {
        // Try opponentLeave first
        let opponentLeft = false;
        try {
          setLoadingModal({ isOpen: true, message: "Leaving game..." });
          if (await contract.opponentLeave(targetGameId)) {
            opponentLeft = true;
            setStatusMessage("Left game successfully");
          }
        } catch (error) {
          console.error("opponentLeave failed:", error);
        } finally {
          setLoadingModal({ isOpen: false, message: "" });
        }
        if (opponentLeft === false) {
          try {
            // If opponentLeave fails, surrender
            setLoadingModal({ isOpen: true, message: "Surrendering game..." });
            await contract.surrender(targetGameId);
            setStatusMessage("Surrendered successfully");
          } catch (error) {
            console.error("Surrender failed:", error);
          } finally {
            setLoadingModal({ isOpen: false, message: "" });
          }
        }
      }

      // Verify game is closed
      const newGameId = await contract.getUserGameId(address);
      if (newGameId !== BYTES32_0) {
        throw new Error("Failed to terminate game");
      }

      // Refresh data
      await loadOngoingGame();
      await loadAvailableGames();
      await loadUserBalance();
    } catch (error) {
      console.error("Failed to force quit game:", error);
      setStatusMessage(
        `Failed to force quit game: ${(error as Error).message}`,
      );
      alert(`Failed to force quit game: ${(error as Error).message}`);
    } finally {
      setIsQuittingOngoingGame(false);
    }
  };

  const afterGameEnd = async () => {
    if (gameManagerRef.current) {
      await gameManagerRef.current.destroy();
      gameManagerRef.current = null;
    }
    // Reset boards to clean state
    const newMyBoard = new GameBoardClass(
      DEFAULT_GRID_SIZE,
      DEFAULT_SHIP_SIZES,
    );
    newMyBoard.initRandom(); // Initialize with random ship placement
    setMyBoard(newMyBoard);

    const newEnemyBoard = new GameBoardClass(
      DEFAULT_GRID_SIZE,
      DEFAULT_SHIP_SIZES,
    );
    setEnemyBoard(newEnemyBoard);

    // Reset shoot state
    setCanShoot(false);
    setCurrentGameData(null);
    setGameViewStatus({ status: "Game Over", isMyTurn: true, isTx: false });
    // Note: auto-shoot state persists across games as requested

    // Refresh data
    await loadOngoingGame();
    await loadAvailableGames();
    await loadUserBalance();
  };

  const initializeGameManager = async (
    overrideBoard?: GameBoardClass,
  ): Promise<GameManager> => {
    const boardToUse = overrideBoard || myBoard;
    if (walletClient && boardToUse && enemyBoard) {
      // Use wagmi's walletClient which is EIP-6963 compatible
      const { provider, signer } = await getProviderAndSigner(walletClient);
      const gameManager = new GameManager(
        provider,
        signer,
        address!,
        boardToUse,
        enemyBoard,
        wagmiConfig,
        supportsAtomicBatch,
        {
          onGameDataUpdate: (gameData) => {
            setCurrentGameData(gameData);
            setStatusMessage(
              `Game updated: ${gameData.gameId.slice(0, 10)}...`,
            );
          },
          onMyBoardUpdate: (/*board*/) => {
            setMyBoardVersion((prev) => prev + 1);
            //setMyBoard(board)
          },
          onEnemyBoardUpdate: (/*board*/) => {
            setEnemyBoardVersion((prev) => prev + 1);
            //setEnemyBoard(board)
          },
          onGameStateChange: (inGame) => {
            setIsInGame(inGame);
            if (!inGame) setCanShoot(false);
          },
          onShootEnabled: (enabled) => {
            setCanShoot(enabled);
          },
          onLoadingChange: (loading, message) => {
            setLoadingModal({ isOpen: loading, message });
          },
          onGameEnd: async (isWinner) => {
            if (isWinner !== null) {
              setGameEndModal({ isOpen: true, isWinner });
            } else {
              await afterGameEnd();
            }
          },
          onGameViewStatusChange: (status, isMyTurn, isTx) => {
            setGameViewStatus({ status, isMyTurn, isTx });
          },
          onMessage: (message) => {
            setStatusMessage(message);
            console.log("[Game]", message);
          },
          onError: (error) => {
            setStatusMessage(`Error: ${error}`);
            console.error("[Game]", error);
          },
        },
      );

      // Check if auto-shoot was enabled in previous game
      const isAutoShootEnabled = gameManager.getAutoShoot();
      setAutoShoot(isAutoShootEnabled);

      return gameManager;
    }
    throw new Error("Ethereum provider not found");
  };

  const loadAvailableGames = async () => {
    setIsLoadingGames(true);
    try {
      if (walletClient) {
        // Use wagmi's walletClient which is EIP-6963 compatible
        const { provider, signer } = await getProviderAndSigner(walletClient);
        const contractInstance = new Contract(
          provider,
          signer,
          wagmiConfig,
          supportsAtomicBatch,
        );
        const games = await contractInstance.listWaitingGameData();
        if (USE_PARTYKIT) {
          const aliveGameId =
            await PartykitManager.getInstance().getActiveGames();
          const _games = games.filter((g) =>
            aliveGameId.has(g.gameId.toLowerCase()),
          );
          setAvailableGames(_games);
        }
        if (USE_P2P) {
          setAvailableGames(games);
        }
        setStatusMessage(`Found ${games.length} available games`);
      }
    } catch (error) {
      console.error("Failed to load games:", error);
      setStatusMessage(`Failed to load games: ${(error as Error).message}`);
    } finally {
      setIsLoadingGames(false);
    }
  };

  const handleRandomizeBoard = () => {
    if (myBoard && !isInGame) {
      myBoard.initRandom();
      // Force re-render by creating new instance with same data
      // const newBoard = new GameBoardClass(DEFAULT_GRID_SIZE, DEFAULT_SHIP_SIZES)
      // newBoard.pos = [...myBoard.pos]
      // newBoard.ships = myBoard.ships.map(s => [...s])
      // setMyBoard(newBoard)
      setMyBoardVersion((prev) => prev + 1);
      setStatusMessage("Board randomized");
    }
  };

  const handleShoot = (position: number) => {
    if (gameManagerRef.current && canShoot) {
      gameManagerRef.current.shoot(position);
    }
  };

  const handleAutoShootToggle = () => {
    if (!gameManagerRef.current) return;
    const newAutoShoot = !autoShoot;
    setAutoShoot(newAutoShoot);
    gameManagerRef.current.enableAutoShoot(newAutoShoot);
  };

  const handleCreateGameButtonClick = async () => {
    if (!address || !walletClient) return;

    // Show loading modal
    setLoadingModal({ isOpen: true, message: "Checking game status..." });

    try {
      // Load ongoing game to check if user already has a game in progress
      await loadOngoingGame();

      // Check if there's an ongoing game (need to get the latest value)
      const { provider, signer } = await getProviderAndSigner(walletClient);
      const contract = new Contract(
        provider,
        signer,
        wagmiConfig,
        supportsAtomicBatch,
      );
      const gameId = await contract.getUserGameId(address);

      if (gameId !== BYTES32_0) {
        // User has an ongoing game
        setLoadingModal({ isOpen: false, message: "" });
        alert(
          "You already have a game in progress. Please finish or quit the current game before creating a new one.",
        );
        return;
      }

      // No ongoing game, close loading and open create modal
      setLoadingModal({ isOpen: false, message: "" });
      setShowCreateModal(true);
    } catch (error) {
      console.error("Failed to check game status:", error);
      setLoadingModal({ isOpen: false, message: "" });
      alert(`Failed to check game status: ${(error as Error).message}`);
    }
  };

  const handleCreateGame = async (stakeAmount: string) => {
    if (!address || !walletClient) return;

    if (stakeAmount.trim() === "") return;
    const n = Number(stakeAmount);
    if (!Number.isFinite(n) || n < 0) {
      return;
    }

    try {
      setShowCreateModal(false);

      // Show loading modal for balance check
      setLoadingModal({ isOpen: true, message: "Checking balance..." });

      const stake = ethers.parseEther(stakeAmount);

      // Check user balance
      const { provider, signer } = await getProviderAndSigner(walletClient);
      const contract = new Contract(
        provider,
        signer,
        wagmiConfig,
        supportsAtomicBatch,
      );

      // Get wallet balance
      const balanceWei = await provider.getBalance(address);
      // Get staked balance
      const userBalance = await contract.getUserBalance(address);
      const stakedBalance =
        userBalance.totalBalance - userBalance.lockedBalance;
      // Total available balance
      const userBalanceTotal = balanceWei + stakedBalance;
      const enoughBalance = userBalanceTotal >= stake;

      if (!enoughBalance) {
        setLoadingModal({ isOpen: false, message: "" });
        const shortfall = ethers.formatEther(stake - userBalanceTotal);
        alert(
          `Insufficient balance. You need at least ${stakeAmount} ETH but only have ${ethers.formatEther(userBalanceTotal)} ETH available. Please deposit ${shortfall} more ETH to continue.`,
        );
        return;
      }

      // Close balance check loading
      setLoadingModal({ isOpen: false, message: "" });
      setStatusMessage("Creating game...");

      // Always create new game manager with proper callbacks for the game
      const gameManager = await initializeGameManager();
      gameManagerRef.current = gameManager;

      // Set the current board to game manager
      if (myBoard) {
        // gameManager.runtimeState.gridMe.pos = [...myBoard.pos]
        // gameManager.runtimeState.gridMe.ships = myBoard.ships.map(s => [...s])
      }

      gameManager.initCreatorGameSalt();
      // preCreateGame
      const gameId = await gameManager.preCreateGame(stake, true);

      let iframe;
      if (USE_P2P) {
        // Create a hidden iframe for P2P test
        iframe = document.createElement("iframe");
        iframe.src = `/p2p_test?roomid=${gameId}`;
        iframe.style.display = "block";
        iframe.style.position = "absolute";
        iframe.style.top = "-1";
        iframe.style.left = "-1";
        iframe.style.width = "1";
        iframe.style.height = "1";
        iframe.style.border = "none";
        document.body.appendChild(iframe);
      }
      // Create game
      let _re;
      try {
        _re = await gameManager.createGame(stake, gameId);
      } finally {
        if (USE_P2P) {
          // Remove
          if (iframe && iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
        }
      }
      if (_re === "networkerror") {
        if (USE_P2P) {
          alert(
            "P2P network connection failed. Please check your network or try again later.",
          );
        }
        if (USE_PARTYKIT) {
          alert(
            "network connection failed. Please check your network or try again later.",
          );
        }
      } else if (_re === "error") {
        alert("Failed to create game. Please try again later.");
      } else if (_re === "success") {
        setStatusMessage("Game created! Waiting for opponent...");
      }
    } catch (error) {
      console.error("Failed to create game:", error);
      setStatusMessage(`Failed to create game: ${(error as Error).message}`);
      alert(`Failed to create game: ${(error as Error).message}`);
    }
  };

  const handleJoinGame = async (game: GameData) => {
    if (!address || !walletClient) return;

    // Show loading modal
    setLoadingModal({ isOpen: true, message: "Checking game status..." });

    try {
      // Load ongoing game to check if user already has a game in progress
      await loadOngoingGame();

      // Check if there's an ongoing game (need to get the latest value)
      const { provider, signer } = await getProviderAndSigner(walletClient);
      const contract = new Contract(
        provider,
        signer,
        wagmiConfig,
        supportsAtomicBatch,
      );
      const gameId = await contract.getUserGameId(address);

      if (gameId !== BYTES32_0) {
        // User has an ongoing game
        setLoadingModal({ isOpen: false, message: "" });
        alert(
          "You already have a game in progress. Please finish or quit the current game before joining a new one.",
        );
        return;
      }

      // Check user balance
      setLoadingModal({ isOpen: true, message: "Checking balance..." });

      // Get wallet balance
      const balanceWei = await provider.getBalance(address);
      // Get staked balance
      const userBalance = await contract.getUserBalance(address);
      const stakedBalance =
        userBalance.totalBalance - userBalance.lockedBalance;
      // Total available balance
      const userBalanceTotal = balanceWei + stakedBalance;
      const enoughBalance = userBalanceTotal >= game.stake;

      if (!enoughBalance) {
        setLoadingModal({ isOpen: false, message: "" });
        const shortfall = ethers.formatEther(game.stake - userBalanceTotal);
        alert(
          `Insufficient balance. You need at least ${ethers.formatEther(game.stake)} ETH but only have ${ethers.formatEther(userBalanceTotal)} ETH available. Please deposit ${shortfall} more ETH to continue.`,
        );
        return;
      }

      // Close loading modal
      setLoadingModal({ isOpen: false, message: "" });
      setStatusMessage("Joining game...");

      // Always create new game manager with proper callbacks for the game
      const gameManager = await initializeGameManager();
      gameManagerRef.current = gameManager;

      // Set the current board to game manager
      if (myBoard) {
        // gameManager.runtimeState.gridMe.pos = [...myBoard.pos]
        // gameManager.runtimeState.gridMe.ships = myBoard.ships.map(s => [...s])
      }

      // Join game
      await gameManager.joinGame(game);

      setStatusMessage("Joined game successfully!");
    } catch (error) {
      console.error("Failed to join game:", error);
      setLoadingModal({ isOpen: false, message: "" });
      setStatusMessage(`Failed to join game: ${(error as Error).message}`);
      alert(`Failed to join game: ${(error as Error).message}`);
    }
  };

  const handleQuitGame = async (game: GameData) => {
    if (!address || !walletClient) return;

    try {
      setStatusMessage("Closing game...");

      // Use wagmi's walletClient which is EIP-6963 compatible
      const { provider, signer } = await getProviderAndSigner(walletClient);
      const contract = new Contract(
        provider,
        signer,
        wagmiConfig,
        supportsAtomicBatch,
      );

      // Get user's current game ID
      const gameId = await contract.getUserGameId(address);

      if (
        gameId ===
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        setStatusMessage("No active game found");
        return;
      }

      // Get game data to check state
      const gameData = await contract.getGameData(gameId);

      // If game is in Join state (waiting for opponent), close idle game
      if (gameData.nextTurnState === NextTurnState.Join) {
        await contract.closeIdleGame(gameId);
        setStatusMessage("Game closed successfully");
      } else {
        // Try opponentLeave first
        let opponentLeft = false;
        try {
          if (await contract.opponentLeave(gameId)) {
            opponentLeft = true;
            setStatusMessage("Left game successfully");
          }
        } catch (error) {
          console.error("opponentLeave failed:", error);
        }
        if (opponentLeft === false) {
          try {
            // If opponentLeave fails, surrender
            await contract.surrender(gameId);
            setStatusMessage("Surrendered successfully");
          } catch (error) {
            console.error("Surrender failed:", error);
          }
        }
      }

      // Verify game is closed
      const newGameId = await contract.getUserGameId(address);
      if (
        newGameId !==
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        throw new Error("Failed to terminate game");
      }

      // Refresh games list and balance
      await loadAvailableGames();
      await loadUserBalance();
    } catch (error) {
      console.error("Failed to quit game:", error);
      setStatusMessage(`Failed to quit game: ${(error as Error).message}`);
      alert(`Failed to quit game: ${(error as Error).message}`);
    }
  };

  const handleWithdraw = async () => {
    if (!address || !userBalance || !withdrawAmount) return;

    try {
      const amount = ethers.parseEther(withdrawAmount);
      const availableBalance =
        userBalance.totalBalance - userBalance.lockedBalance;

      // Validate amount
      if (amount <= BigInt(0)) {
        alert("Withdrawal amount must be greater than 0");
        return;
      }

      if (amount > availableBalance) {
        alert(
          `Cannot withdraw more than available balance: ${ethers.formatEther(availableBalance)} ETH`,
        );
        return;
      }

      setIsWithdrawing(true);
      setStatusMessage("Processing withdrawal...");

      // Use wagmi's walletClient which is EIP-6963 compatible
      if (!walletClient) {
        throw new Error("Wallet not connected");
      }
      const { provider, signer } = await getProviderAndSigner(walletClient);
      const contract = new Contract(
        provider,
        signer,
        wagmiConfig,
        supportsAtomicBatch,
      );

      setLoadingModal({ isOpen: true, message: "Processing withdrawal..." });
      try {
        await contract.withdraw(amount);
      } finally {
        setLoadingModal({ isOpen: false, message: "" });
      }

      setStatusMessage("Withdrawal successful!");
      setShowWithdrawModal(false);
      setWithdrawAmount("");

      // Refresh balance
      await loadUserBalance();
    } catch (error) {
      console.error("Failed to withdraw:", error);
      setStatusMessage(`Withdrawal failed: ${(error as Error).message}`);
      alert(`Withdrawal failed: ${(error as Error).message}`);
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleMaxWithdraw = () => {
    if (userBalance) {
      const availableBalance =
        userBalance.totalBalance - userBalance.lockedBalance;
      setWithdrawAmount(ethers.formatEther(availableBalance));
    }
  };

  // Monitor isTx changes to show/hide transaction confirmation modal
  useEffect(() => {
    if (gameViewStatus.isTx) {
      // Show transaction confirmation modal
      setShowTxConfirmModal(true);

      // Clear any existing timer
      if (txConfirmTimerRef.current) {
        clearTimeout(txConfirmTimerRef.current);
      }

      // Set timer to auto-close after 7 seconds
      txConfirmTimerRef.current = setTimeout(() => {
        setShowTxConfirmModal(false);
        txConfirmTimerRef.current = null;
      }, 1000 * 7);
    } else {
      // Hide modal when isTx becomes false
      setShowTxConfirmModal(false);
      if (txConfirmTimerRef.current) {
        clearTimeout(txConfirmTimerRef.current);
        txConfirmTimerRef.current = null;
      }
    }
  }, [gameViewStatus.isTx]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gameManagerRef.current) {
        gameManagerRef.current.destroy();
      }
      // Clean up transaction confirmation timer
      if (txConfirmTimerRef.current) {
        clearTimeout(txConfirmTimerRef.current);
      }
    };
  }, []);

  // Wait for client-side mounting
  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900">
        <div className="text-white">Loading...</div>
      </div>
    );
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
                    <span className="font-bold">
                      {ethers.formatEther(userBalance.totalBalance)} ETH
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-blue-200">Locked:</span>
                    <span className="font-semibold">
                      {ethers.formatEther(userBalance.lockedBalance)} ETH
                    </span>
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
            <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
              <p className="text-white text-sm">{statusMessage}</p>
              <button
                onClick={async () => {
                  const targetGameId = currentGameData?.gameId;
                  if (!targetGameId) return;
                  setOngoingGameId(targetGameId);
                  await handleForceQuitOngoingGame(targetGameId);
                  await afterGameEnd();
                }}
                style={{ display: isInGame ? "block" : "none" }}
                disabled={!currentGameData || isQuittingOngoingGame}
                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Quit Game
              </button>
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
                  {myBoard && (
                    <GameBoardComponent
                      board={myBoard}
                      version={myBoardVersion}
                    />
                  )}
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
                    onClick={handleCreateGameButtonClick}
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
                      <span className="text-blue-500 font-medium">
                        Game ID:
                      </span>{" "}
                      <span className="font-mono text-yellow-600">
                        {currentGameData.gameId.slice(0, 10)}...
                      </span>
                    </div>
                    <div>
                      <span className="text-blue-500 font-medium">Stake:</span>{" "}
                      <span className="font-bold text-green-600">
                        {ethers.formatEther(currentGameData.stake)} ETH
                      </span>
                    </div>
                    <div>
                      <span
                        className={`font-bold ${gameViewStatus.isMyTurn ? "text-green-400" : "text-cyan-600"}`}
                      >
                        {gameViewStatus.isMyTurn ? "🎯 " : "⏳ "}
                        {gameViewStatus.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-end">
                      <button
                        onClick={handleAutoShootToggle}
                        className={`px-4 py-2 rounded-lg font-semibold transition-all ${
                          autoShoot
                            ? "bg-green-600 hover:bg-green-700 text-white"
                            : "bg-gray-600 hover:bg-gray-700 text-gray-200"
                        }`}
                        title={
                          autoShoot
                            ? "Auto-shoot enabled"
                            : "Auto-shoot disabled"
                        }
                      >
                        {autoShoot ? "🤖 Auto" : "👆 Manual"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Boards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left: My Board */}
                <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl shadow-2xl p-6">
                  <h2 className="text-2xl font-bold text-white mb-4">
                    My Board
                  </h2>
                  <div className="flex justify-center">
                    {myBoard && (
                      <GameBoardComponent
                        board={myBoard}
                        version={myBoardVersion}
                      />
                    )}
                  </div>
                </div>

                {/* Right: Enemy Board */}
                <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl shadow-2xl p-6">
                  <h2 className="text-2xl font-bold text-white mb-4">
                    Enemy Board
                  </h2>
                  <div className="flex justify-center">
                    {enemyBoard && (
                      <GameBoardComponent
                        board={enemyBoard}
                        version={enemyBoardVersion}
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
              <h2 className="text-2xl font-bold text-white mb-6">
                💰 Withdraw Funds
              </h2>

              {userBalance && (
                <div className="mb-6 space-y-2">
                  <div className="flex justify-between text-white">
                    <span className="text-blue-200">Total Balance:</span>
                    <span className="font-bold">
                      {ethers.formatEther(userBalance.totalBalance)} ETH
                    </span>
                  </div>
                  <div className="flex justify-between text-white">
                    <span className="text-blue-200">Locked Balance:</span>
                    <span className="font-semibold">
                      {ethers.formatEther(userBalance.lockedBalance)} ETH
                    </span>
                  </div>
                  <div className="flex justify-between text-white border-t border-blue-400 pt-2">
                    <span className="text-green-300">Available:</span>
                    <span className="font-bold text-green-300">
                      {ethers.formatEther(
                        userBalance.totalBalance - userBalance.lockedBalance,
                      )}{" "}
                      ETH
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
                    setShowWithdrawModal(false);
                    setWithdrawAmount("");
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
                  {isWithdrawing ? "Processing..." : "Withdraw"}
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
            setGameEndModal({ isOpen: false, isWinner: false });
            // Stop the game after animation
            await afterGameEnd();
          }}
        />

        {/* Transaction Confirmation Modal */}
        {showTxConfirmModal && (
          <div className="fixed inset-0 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-gradient-to-br from-orange-600 to-red-600 rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 border-4 border-yellow-400">
              <div className="text-center space-y-6">
                {/* Warning Icon */}
                <div className="flex justify-center">
                  <div className="relative">
                    <div className="absolute inset-0 bg-yellow-400 rounded-full blur-xl opacity-50 animate-ping"></div>
                    <div className="relative bg-yellow-400 rounded-full p-4">
                      <svg
                        className="w-16 h-16 text-orange-600"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Warning Message */}
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-white">
                    ⚡ Transaction Required!
                  </h2>
                  <p className="text-white text-lg font-semibold">
                    Please confirm the transaction in your wallet NOW!
                  </p>
                  <p className="text-yellow-200 text-sm">
                    Delays over 5 seconds may cause you to lose the game.
                  </p>
                </div>

                {/* Wallet Animation */}
                <div className="flex justify-center">
                  <div className="relative">
                    {/* Wallet Icon with Click Animation */}
                    <div className="bg-white rounded-xl p-6 shadow-2xl transform hover:scale-105 transition-transform">
                      <svg
                        className="w-20 h-20 text-blue-600 animate-bounce"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                        />
                      </svg>
                    </div>
                    {/* Click Here Indicator */}
                    <div className="absolute -top-2 -right-2 bg-green-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
                      CLICK
                    </div>
                    {/* Animated Arrows */}
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                      <div className="flex space-x-1 animate-ping">
                        <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animation-delay-200"></div>
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animation-delay-400"></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Countdown Timer */}
                <div className="text-white text-sm font-mono">
                  Auto-closing in 5 seconds...
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </NetworkGuard>
  );
}
