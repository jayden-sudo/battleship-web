"use client";

import { GameBoard as GameBoardClass } from "@/utils/gameBoard";
import { PosStatus, DEFAULT_GRID_SIZE } from "@/utils/interfaces";

interface GameBoardProps {
  board: GameBoardClass;
  version: number;
  isEnemy?: boolean;
  canShoot?: boolean;
  onShoot?: (position: number) => void;
}

const DEFAULT_BORDER_COLOR = "#b4b4ff";
const SHIP_BORDER_COLOR = "#3b82f6"; // Blue for unattacked ships
const SUNK_BORDER_COLOR = "#dc2626"; // Red for sunk ships

export function GameBoardComponent({
  board,
  isEnemy = false,
  canShoot = false,
  onShoot,
}: GameBoardProps) {
  const gridSize = DEFAULT_GRID_SIZE;

  // Check if any cell is in AttackedPending state (only for enemy board)
  const hasPendingAttack =
    isEnemy &&
    board.pos.some((cell) => cell?.posStatus === PosStatus.AttackedPending);

  const isShootable = (index: number) => {
    if (!isEnemy || !canShoot) return false;
    const cell = board.pos[index];
    return cell && cell.posStatus === PosStatus.Unknown;
  };

  const handleCellClick = (index: number) => {
    if (isShootable(index) && onShoot) {
      onShoot(index);
    }
  };

  // Check if adjacent cell belongs to the same ship
  const isSameShip = (
    index: number,
    adjacentIndex: number,
    shipIndex: number,
  ): boolean => {
    if (adjacentIndex < 0 || adjacentIndex >= gridSize * gridSize) return false;
    const adjacentCell = board.pos[adjacentIndex];
    return adjacentCell && adjacentCell.shipIndex === shipIndex;
  };

  // Get the outer border style for a ship cell (using collapsed border approach)
  const getShipBorderStyle = (
    index: number,
    shipIndex: number,
    isSunk: boolean,
  ) => {
    const row = Math.floor(index / gridSize);
    const col = index % gridSize;

    const borderColor = isSunk ? SUNK_BORDER_COLOR : SHIP_BORDER_COLOR;
    const shipBorderWidth = "2px";
    const defaultBorderWidth = "1px";

    // Check each direction - only draw colored border if adjacent cell is NOT the same ship
    const topIndex = row > 0 ? index - gridSize : -1;
    const bottomIndex = row < gridSize - 1 ? index + gridSize : -1;
    const leftIndex = col > 0 ? index - 1 : -1;
    const rightIndex = col < gridSize - 1 ? index + 1 : -1;

    const hasTopBorder = !isSameShip(index, topIndex, shipIndex);
    const hasBottomBorder = !isSameShip(index, bottomIndex, shipIndex);
    const hasLeftBorder = !isSameShip(index, leftIndex, shipIndex);
    const hasRightBorder = !isSameShip(index, rightIndex, shipIndex);

    // Build border style respecting collapsed border approach
    const result: React.CSSProperties = {
      borderStyle: "solid",
      // Right border (always present in collapsed approach)
      borderRightWidth: hasRightBorder ? shipBorderWidth : defaultBorderWidth,
      borderRightColor: hasRightBorder ? borderColor : DEFAULT_BORDER_COLOR,
      // Bottom border (always present in collapsed approach)
      borderBottomWidth: hasBottomBorder ? shipBorderWidth : defaultBorderWidth,
      borderBottomColor: hasBottomBorder ? borderColor : DEFAULT_BORDER_COLOR,
      // Left border (only first column OR ship outer edge)
      borderLeftWidth:
        col === 0 || hasLeftBorder
          ? hasLeftBorder
            ? shipBorderWidth
            : defaultBorderWidth
          : "0px",
      borderLeftColor: hasLeftBorder ? borderColor : DEFAULT_BORDER_COLOR,
      // Top border (only first row OR ship outer edge)
      borderTopWidth:
        row === 0 || hasTopBorder
          ? hasTopBorder
            ? shipBorderWidth
            : defaultBorderWidth
          : "0px",
      borderTopColor: hasTopBorder ? borderColor : DEFAULT_BORDER_COLOR,
    };

    return result;
  };

  // Get cell state info
  const getCellState = (index: number) => {
    const cell = board.pos[index];
    if (!cell)
      return {
        isMiss: false,
        isHit: false,
        isSunk: false,
        isPending: false,
        isShip: false,
        shipIndex: -1,
      };

    const { shipIndex, posStatus } = cell;

    if (isEnemy) {
      return {
        isMiss: posStatus === PosStatus.EmptyAttacked,
        isHit: posStatus === PosStatus.ShipAttacked,
        isSunk: posStatus === PosStatus.ShipSunk,
        isPending: posStatus === PosStatus.AttackedPending,
        isShip: shipIndex > -1,
        shipIndex,
      };
    } else {
      return {
        isMiss: posStatus === PosStatus.EmptyAttacked,
        isHit: posStatus === PosStatus.ShipAttacked,
        isSunk: posStatus === PosStatus.ShipSunk,
        isPending: false,
        isShip: shipIndex > -1,
        shipIndex,
      };
    }
  };

  // Get cell style using collapsed border approach
  // Each cell has right and bottom border, grid container has left and top border
  const getCellStyle = (index: number) => {
    const state = getCellState(index);
    const row = Math.floor(index / gridSize);
    const col = index % gridSize;

    const baseStyle: React.CSSProperties = {
      backgroundColor: "white",
      borderStyle: "solid",
      borderRightWidth: "1px",
      borderBottomWidth: "1px",
      borderRightColor: DEFAULT_BORDER_COLOR,
      borderBottomColor: DEFAULT_BORDER_COLOR,
      // First column needs left border
      borderLeftWidth: col === 0 ? "1px" : "0px",
      borderLeftColor: DEFAULT_BORDER_COLOR,
      // First row needs top border
      borderTopWidth: row === 0 ? "1px" : "0px",
      borderTopColor: DEFAULT_BORDER_COLOR,
    };

    // Ship cells on my board (with outer border)
    if (!isEnemy && state.isShip && state.shipIndex > -1) {
      const isSunk = state.isSunk;
      const shipBorders = getShipBorderStyle(index, state.shipIndex, isSunk);
      return {
        ...baseStyle,
        ...shipBorders,
      };
    }

    // Sunk ship cells on enemy board (with outer border)
    if (isEnemy && state.isSunk && state.shipIndex > -1) {
      const shipBorders = getShipBorderStyle(index, state.shipIndex, true);
      return {
        ...baseStyle,
        ...shipBorders,
      };
    }

    return baseStyle;
  };

  return (
    <div className="inline-block relative group">
      <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 rounded-lg blur opacity-25 group-hover:opacity-40 transition duration-1000 animate-pulse"></div>

      <div
        className="grid relative rounded-lg overflow-hidden shadow-2xl"
        style={{
          gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
          background: "linear-gradient(135deg, #e0f2ff 0%, #bae6ff 100%)",
        }}
      >
        {board.pos.map((_, index) => {
          const shootable = isShootable(index);
          const state = getCellState(index);

          return (
            <div
              key={index}
              onClick={() => handleCellClick(index)}
              style={getCellStyle(index)}
              className={`
                w-12 h-12
                flex items-center justify-center
                relative
                group/cell
                ${shootable ? "cursor-crosshair hover:bg-cyan-100 hover:scale-110 hover:z-10 hover:shadow-lg" : ""}
                transition-all duration-200
              `}
            >
              {shootable && (
                <div className="absolute inset-0 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8">
                    <div className="absolute top-0 left-1/2 w-0.5 h-2 bg-red-500 -translate-x-1/2"></div>
                    <div className="absolute bottom-0 left-1/2 w-0.5 h-2 bg-red-500 -translate-x-1/2"></div>
                    <div className="absolute left-0 top-1/2 h-0.5 w-2 bg-red-500 -translate-y-1/2"></div>
                    <div className="absolute right-0 top-1/2 h-0.5 w-2 bg-red-500 -translate-y-1/2"></div>
                    <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-red-500 rounded-full -translate-x-1/2 -translate-y-1/2"></div>
                  </div>
                </div>
              )}

              {state.isMiss && (
                <div className="relative">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping absolute"></div>
                  <div className="w-2 h-2 rounded-full bg-blue-600"></div>

                  <div className="absolute -inset-2 border-2 border-blue-300 rounded-full animate-pulse"></div>
                </div>
              )}

              {state.isPending && (
                <div className="relative">
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
                  <div className="absolute -inset-1 border-2 border-yellow-300 rounded-full animate-ping"></div>
                </div>
              )}

              {(state.isHit || state.isSunk) && (
                <div className="relative w-full h-full flex items-center justify-center">
                  <div className="absolute inset-0">
                    <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-orange-500 rounded-full -translate-x-1/2 -translate-y-1/2 animate-ping"></div>
                    <div className="absolute top-1 left-1/2 w-1 h-1 bg-red-500 rounded-full"></div>
                    <div className="absolute bottom-1 left-1/2 w-1 h-1 bg-red-500 rounded-full"></div>
                    <div className="absolute left-1 top-1/2 w-1 h-1 bg-orange-500 rounded-full"></div>
                    <div className="absolute right-1 top-1/2 w-1 h-1 bg-orange-500 rounded-full"></div>
                  </div>

                  <div className="relative z-10">
                    <div
                      className="absolute inset-2"
                      style={{
                        background: `linear-gradient(to top right, transparent calc(50% - 1.5px), #dc2626 calc(50% - 1.5px), #dc2626 calc(50% + 1.5px), transparent calc(50% + 1.5px))`,
                      }}
                    />
                    <div
                      className="absolute inset-2"
                      style={{
                        background: `linear-gradient(to top left, transparent calc(50% - 1.5px), #dc2626 calc(50% - 1.5px), #dc2626 calc(50% + 1.5px), transparent calc(50% + 1.5px))`,
                      }}
                    />
                  </div>

                  <div className="absolute inset-0 bg-red-500 opacity-20 rounded-full animate-ping"></div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Semi-transparent overlay when waiting for opponent's report */}
      {hasPendingAttack && (
        <div className="absolute inset-0 pointer-events-auto cursor-not-allowed">
          <div className="absolute inset-0 bg-white opacity-30 animate-pulse"></div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl animate-spin">
            ⏳
          </div>
        </div>
      )}
    </div>
  );
}
