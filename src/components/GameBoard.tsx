'use client'

import { GameBoard as GameBoardClass } from '@/utils/gameBoard'
import { PosStatus, DEFAULT_GRID_SIZE } from '@/utils/interfaces'

interface GameBoardProps {
  board: GameBoardClass
  isEnemy?: boolean
  canShoot?: boolean
  onShoot?: (position: number) => void
}

const DEFAULT_BORDER_COLOR = '#b4b4ff'
const SHIP_BORDER_COLOR = '#3b82f6' // Blue for unattacked ships
const SUNK_BORDER_COLOR = '#dc2626' // Red for sunk ships

export function GameBoardComponent({ board, isEnemy = false, canShoot = false, onShoot }: GameBoardProps) {
  const gridSize = DEFAULT_GRID_SIZE

  // Check if any cell is in AttackedPending state (only for enemy board)
  const hasPendingAttack = isEnemy && board.pos.some(cell => cell?.posStatus === PosStatus.AttackedPending)

  const isShootable = (index: number) => {
    if (!isEnemy || !canShoot) return false
    const cell = board.pos[index]
    return cell && cell.posStatus === PosStatus.Unknown
  }

  const handleCellClick = (index: number) => {
    if (isShootable(index) && onShoot) {
      onShoot(index)
    }
  }

  // Check if adjacent cell belongs to the same ship
  const isSameShip = (index: number, adjacentIndex: number, shipIndex: number): boolean => {
    if (adjacentIndex < 0 || adjacentIndex >= gridSize * gridSize) return false
    const adjacentCell = board.pos[adjacentIndex]
    return adjacentCell && adjacentCell.shipIndex === shipIndex
  }

  // Get the outer border style for a ship cell (using collapsed border approach)
  const getShipBorderStyle = (index: number, shipIndex: number, isSunk: boolean) => {
    const row = Math.floor(index / gridSize)
    const col = index % gridSize
    
    const borderColor = isSunk ? SUNK_BORDER_COLOR : SHIP_BORDER_COLOR
    const shipBorderWidth = '2px'
    const defaultBorderWidth = '1px'
    
    // Check each direction - only draw colored border if adjacent cell is NOT the same ship
    const topIndex = row > 0 ? index - gridSize : -1
    const bottomIndex = row < gridSize - 1 ? index + gridSize : -1
    const leftIndex = col > 0 ? index - 1 : -1
    const rightIndex = col < gridSize - 1 ? index + 1 : -1
    
    const hasTopBorder = !isSameShip(index, topIndex, shipIndex)
    const hasBottomBorder = !isSameShip(index, bottomIndex, shipIndex)
    const hasLeftBorder = !isSameShip(index, leftIndex, shipIndex)
    const hasRightBorder = !isSameShip(index, rightIndex, shipIndex)
    
    // Build border style respecting collapsed border approach
    const result: React.CSSProperties = {
      borderStyle: 'solid',
      // Right border (always present in collapsed approach)
      borderRightWidth: hasRightBorder ? shipBorderWidth : defaultBorderWidth,
      borderRightColor: hasRightBorder ? borderColor : DEFAULT_BORDER_COLOR,
      // Bottom border (always present in collapsed approach)
      borderBottomWidth: hasBottomBorder ? shipBorderWidth : defaultBorderWidth,
      borderBottomColor: hasBottomBorder ? borderColor : DEFAULT_BORDER_COLOR,
      // Left border (only first column OR ship outer edge)
      borderLeftWidth: (col === 0 || hasLeftBorder) ? (hasLeftBorder ? shipBorderWidth : defaultBorderWidth) : '0px',
      borderLeftColor: hasLeftBorder ? borderColor : DEFAULT_BORDER_COLOR,
      // Top border (only first row OR ship outer edge)
      borderTopWidth: (row === 0 || hasTopBorder) ? (hasTopBorder ? shipBorderWidth : defaultBorderWidth) : '0px',
      borderTopColor: hasTopBorder ? borderColor : DEFAULT_BORDER_COLOR,
    }
    
    return result
  }

  // Get cell state info
  const getCellState = (index: number) => {
    const cell = board.pos[index]
    if (!cell) return { isMiss: false, isHit: false, isSunk: false, isPending: false, isShip: false, shipIndex: -1 }
    
    const { shipIndex, posStatus } = cell
    
    if (isEnemy) {
      return {
        isMiss: posStatus === PosStatus.EmptyAttacked,
        isHit: posStatus === PosStatus.ShipAttacked,
        isSunk: posStatus === PosStatus.ShipSunk,
        isPending: posStatus === PosStatus.AttackedPending,
        isShip: shipIndex > -1,
        shipIndex,
      }
    } else {
      return {
        isMiss: posStatus === PosStatus.EmptyAttacked,
        isHit: posStatus === PosStatus.ShipAttacked,
        isSunk: posStatus === PosStatus.ShipSunk,
        isPending: false,
        isShip: shipIndex > -1,
        shipIndex,
      }
    }
  }

  // Get cell style using collapsed border approach
  // Each cell has right and bottom border, grid container has left and top border
  const getCellStyle = (index: number) => {
    const state = getCellState(index)
    const row = Math.floor(index / gridSize)
    const col = index % gridSize
    
    const baseStyle: React.CSSProperties = {
      backgroundColor: 'white',
      borderStyle: 'solid',
      borderRightWidth: '1px',
      borderBottomWidth: '1px',
      borderRightColor: DEFAULT_BORDER_COLOR,
      borderBottomColor: DEFAULT_BORDER_COLOR,
      // First column needs left border
      borderLeftWidth: col === 0 ? '1px' : '0px',
      borderLeftColor: DEFAULT_BORDER_COLOR,
      // First row needs top border
      borderTopWidth: row === 0 ? '1px' : '0px',
      borderTopColor: DEFAULT_BORDER_COLOR,
    }
    
    // Ship cells on my board (with outer border)
    if (!isEnemy && state.isShip && state.shipIndex > -1) {
      const isSunk = state.isSunk
      const shipBorders = getShipBorderStyle(index, state.shipIndex, isSunk)
      return {
        ...baseStyle,
        ...shipBorders,
      }
    }
    
    // Sunk ship cells on enemy board (with outer border)
    if (isEnemy && state.isSunk && state.shipIndex > -1) {
      const shipBorders = getShipBorderStyle(index, state.shipIndex, true)
      return {
        ...baseStyle,
        ...shipBorders,
      }
    }
    
    return baseStyle
  }

  return (
    <div className="inline-block relative">
      <div 
        className="grid" 
        style={{ 
          gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
        }}
      >
        {board.pos.map((_, index) => {
          const shootable = isShootable(index)
          const state = getCellState(index)
          
          return (
            <div
              key={index}
              onClick={() => handleCellClick(index)}
              style={getCellStyle(index)}
              className={`
                w-12 h-12
                flex items-center justify-center
                relative
                ${shootable ? 'cursor-crosshair hover:bg-gray-100' : ''}
                transition-colors
              `}
            >
              {/* Miss indicator: black dot */}
              {state.isMiss && (
                <div 
                  className="w-1.5 h-1.5 rounded-full bg-black"
                />
              )}

              {/* Pending attack indicator: gray dot (same style as miss but different color) */}
              {state.isPending && (
                <div 
                  className="w-1.5 h-1.5 rounded-full bg-gray-400"
                />
              )}
              
              {/* Hit indicator: red X (CSS diagonal lines) */}
              {(state.isHit || state.isSunk) && (
                <>
                  <div 
                    className="absolute inset-2"
                    style={{
                      background: `linear-gradient(to top right, transparent calc(50% - 1px), #dc2626 calc(50% - 1px), #dc2626 calc(50% + 1px), transparent calc(50% + 1px))`,
                    }}
                  />
                  <div 
                    className="absolute inset-2"
                    style={{
                      background: `linear-gradient(to top left, transparent calc(50% - 1px), #dc2626 calc(50% - 1px), #dc2626 calc(50% + 1px), transparent calc(50% + 1px))`,
                    }}
                  />
                </>
              )}
            </div>
          )
        })}
      </div>
      
      {/* Semi-transparent overlay when waiting for opponent's report */}
      {hasPendingAttack && (
        <div 
          className="absolute inset-0 bg-white pointer-events-auto cursor-not-allowed"
          style={{ opacity: 0.2 }}
        />
      )}
    </div>
  )
}

