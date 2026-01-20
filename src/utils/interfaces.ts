// #region Constants
export const BYTES32_0 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
export const SENTINEL_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
export const ROUND_TIME_LIMIT = Number(
  process.env.NEXT_PUBLIC_ROUND_TIME_LIMIT,
); // Seconds, from contract
export const REVEAL_RANDOMNESS_LIMIT = Number(
  process.env.NEXT_PUBLIC_REVEAL_RANDOMNESS_LIMIT,
); // Seconds, from contract
export const DEFAULT_GRID_SIZE = 6;
export const DEFAULT_SHIP_SIZES = [3, 2, 1];
// #endregion

// #region Enums

/**
 * Represents the state of the game turn, determining which player should act next.
 * Mirrors the enum in the smart contract.
 */
export const NextTurnState = {
  Blank: 0, // 0: The game is in an uninitialized or invalid state.
  Join: 1, // 1: The game is waiting for a second player to join.
  RevealRandomness: 2, // 2: Both players must reveal their randomness to determine initiative.
  CreatorFire: 3, // 3: It is the creator's turn to fire a shot.
  JoinerFire: 4, // 4: It is the joiner's turn to fire a shot.
  CreatorReport: 5, // 5: The creator must report the result of the joiner's shot.
  JoinerReport: 6, // 6: The joiner must report the result of the creator's shot.
  Completed: 7, // 7: The game has concluded.
};

/**
 * Represents the status of a single position on the game grid.
 */
export const PosStatus = {
  Unknown: -1,
  EmptyUnattacked: 0,
  EmptyAttacked: 1,
  ShipUnattacked: 2,
  ShipAttacked: 3,
  ShipSunk: 4,
  /**
   * @name AttackedPending
   * After the player clicks on the opponent’s board,
   * the player cannot immediately know whether the shot hit an opponent’s ship.
   * The result must wait for the opponent’s REPORT,
   * which may take 0.1–10 seconds. During this period,
   * the corresponding shot cell on the opponent’s board
   * should be temporarily updated to a pending / waiting state.
   */
  AttackedPending: 5,
};

/**
 * Represents the result of a shot.
 * Mirrors the enum in the smart contract.
 */
export const FireStatus = {
  STATUS_MISS: 0,
  STATUS_HIT: 1,
  STATUS_SUNK: 2,
};

// #endregion

// #region Interfaces and Types

// ######## P2P Protocol Types ########
export type P2PMessage =
  | { type: "connect"; data: any }
  | {
      type: "requestCreatorSignature";
      data: { gameId: string; myWalletAddress: string };
    }
  | { type: "creatorSignature"; data: { endTime: number; signature: string } }
  | {
      type: "shot";
      data: { statusHash: string; position: number; signature: string };
    }
  | {
      type: "report";
      data: {
        statusHash: string;
        position: number;
        shotResult: ShotResult;
        signature: string;
        poof: string;
      };
    }
  | { type: "surrender"; data: string };

// ######## Action Queue Types ########
/*
         The game was closed before I joined
            'GAME_CLOSED' |
         The original random salt needs to be revealed
            'REVEAL_SALT' |
         When acting as the joiner, a signature must be requested from the opponent
            'REQUEST_CREATOR_SIGNATURE' |
         When acting as the creator, my signature must be sent to the opponent
            'SIGN_CREATOR_SIGNATURE' |
        I need to join the game
            'JOIN' |

         I need to submit the shot position
            'SHOT' |
         I need to submit a report
            'REPORT' |

         A shot position previously submitted by me
            'SELF_SHOT' |
         A report previously submitted by me
            'SELF_REPORT' |

         An incoming shot from the opponent
            'ENEMY_SHOT' |
         A report submitted by the opponent
            'ENEMY_REPORT' |

         I need to surrender
            'SELF_SURRENDER' |
    The opponent has surrendered
            'ENEMY_SURRENDER' |
         The game has ended
            'GAME_END' 
*/
export type Action =
  | { type: "GAME_CLOSED"; data: {} }
  | { type: "REVEAL_SALT"; data: ActionData_Actor }
  | { type: "REQUEST_CREATOR_SIGNATURE"; data: {} }
  | { type: "SIGN_CREATOR_SIGNATURE"; data: ActionData_SignCreatorSignature }
  | { type: "JOIN"; data: ActionData_Join }
  | { type: "WAITING_FOR_SHOOT"; data: ActionData_Actor }
  | { type: "SHOT"; data: ActionData_ShootAt }
  | { type: "REPORT"; data: ActionData_SelfReport }
  | { type: "SELF_SHOT"; data: ActionData_Shot }
  | { type: "ENEMY_SHOT"; data: ActionData_Shot }
  | { type: "SELF_REPORT"; data: ActionData_Report }
  | { type: "ENEMY_REPORT"; data: ActionData_Report }
  | { type: "SELF_SURRENDER"; data: {} }
  | { type: "ENEMY_SURRENDER"; data: ActionData_EnemySurrender }
  | { type: "GAME_END"; data: ActionData_GameEnd }
  | { type: "TRY_OPPONENT_LEAVE"; data: {} }
  | { type: "UPDATE_GAME_STATUS"; data: {} }
  | { type: "SELF_SUBMIT_WIN_PROOF"; data: {} }
  | { type: "REPORT_CHEATING"; data: ActionData_ReportCheating };

export interface ActionData_Actor {
  actorIsCreator: boolean;
}

export interface ActionData_SignCreatorSignature {
  gameId: string;
  walletAddress: string;
}
export interface ActionData_Join {
  endTime: number;
  creatorSignature: string;
}
export interface ActionData_ShootAt {
  fireAt: number;
}
export interface ActionData_Shot {
  mergeEnd: number; // Used for handling out-of-order messages
  fromContract: boolean;
  statusHash: string;
  position: number;
  signature: string;
}
export interface ActionData_Report extends ActionData_Shot {
  shotResult: ShotResult;
  poof: string;
}
export interface ActionData_SelfReport {
  position: number;
  shotResult: ShotResult;
  poof: string;
  // debuggerData: any;
}
export interface ActionData_EnemySurrender {
  enemySignature: string;
}
export interface ActionData_GameEnd {
  winner: string;
}
export interface ActionData_ReportCheating {
  firePosition: number;
  signature: string;
}

// ######## Contract Data Structures ########
export interface UserBalance {
  totalBalance: bigint;
  lockedBalance: bigint;
}
export interface GameDataInner {
  creator: string;
  joiner: string;
  creatorRandomnessCommitment: string;
  joinerRandomnessSalt: string;
  creatorBoardCommitment: string;
  joinerBoardCommitment: string;
  stake: bigint;
  lastActiveTimestamp: bigint;
  creatorGameBoard: bigint;
  joinerGameBoard: bigint;
  nextTurnState: (typeof NextTurnState)[keyof typeof NextTurnState];
  fireAtPosition: number;
  previousGameStatusHash: string;
  currentGameStatusHash: string;
  creatorSessionKey: string;
  joinerSessionKey: string;
  p2pRoomId: string;
}
export interface GameData extends GameDataInner {
  gameId: string;
}

// ######## Game Logic Structures ########
export interface ShotResult {
  shotStatus: (typeof FireStatus)[keyof typeof FireStatus];
  sunkHeadPosition: number;
  sunkEndPosition: number;
}
export interface PosShipStatus {
  shipIndex: number; // Index into the `ships` array
  posStatus: (typeof PosStatus)[keyof typeof PosStatus];
}
export type HashChainStatus =
  | "None"
  | "CreatorFire"
  | "JoinerFire"
  | "CreatorReport"
  | "JoinerReport";

export type GameViewStatus =
  | HashChainStatus
  | "Joining"
  | "RevealingRandomness"
  | "Completed";

export interface HashChainData {
  status: HashChainStatus;
  value: ShotResult | number;
  proof: string | undefined;
  signature: string;
  hasInContract: boolean;
  // debuggerData: any;
}
export interface HashChainItem extends HashChainData {
  hash: string;
}
// #endregion
