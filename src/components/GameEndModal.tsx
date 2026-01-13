'use client'

import { useEffect, useState } from 'react'

interface GameEndModalProps {
  isOpen: boolean
  isWinner: boolean
  onClose: () => void
}

export function GameEndModal({ isOpen, isWinner, onClose }: GameEndModalProps) {
  const [phase, setPhase] = useState<'zoom' | 'shake' | 'stable' | 'fadeout'>('zoom')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setVisible(true)
      setPhase('zoom')
      
      // Phase 1: Zoom in (0-300ms)
      const shakeTimer = setTimeout(() => setPhase('shake'), 300)
      // Phase 2: Shake (300-800ms)
      const stableTimer = setTimeout(() => setPhase('stable'), 800)
      // Phase 3: Stable display (800-3500ms)
      const fadeTimer = setTimeout(() => setPhase('fadeout'), 3500)
      // Phase 4: Fadeout and close (3500-4000ms)
      const closeTimer = setTimeout(() => {
        setVisible(false)
        onClose()
      }, 4000)

      return () => {
        clearTimeout(shakeTimer)
        clearTimeout(stableTimer)
        clearTimeout(fadeTimer)
        clearTimeout(closeTimer)
      }
    }
  }, [isOpen, onClose])

  if (!visible) return null

  const mainText = isWinner ? 'VICTORY' : 'DEFEAT'
  const subText = isWinner ? 'YOU WIN!' : 'YOU LOSE!'
  const mainColor = isWinner ? '#FFD700' : '#FF4444'
  const glowColor = isWinner ? '#FFA500' : '#CC0000'
  const bgGradient = isWinner 
    ? 'radial-gradient(ellipse at center, rgba(255,215,0,0.3) 0%, rgba(0,0,0,0.95) 70%)'
    : 'radial-gradient(ellipse at center, rgba(255,0,0,0.3) 0%, rgba(0,0,0,0.95) 70%)'

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        background: bgGradient,
        opacity: phase === 'fadeout' ? 0 : 1,
        transition: phase === 'fadeout' ? 'opacity 0.5s ease-out' : 'none',
      }}
    >
      {/* Background flash effect */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: phase === 'zoom' ? `radial-gradient(circle, ${mainColor}40 0%, transparent 50%)` : 'transparent',
          transition: 'background 0.3s ease-out',
        }}
      />

      {/* Main KO text container */}
      <div 
        className="relative select-none"
        style={{
          transform: phase === 'zoom' 
            ? 'scale(0.1)' 
            : phase === 'shake' 
              ? 'scale(1.1)' 
              : 'scale(1)',
          transition: phase === 'zoom' 
            ? 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' 
            : 'transform 0.2s ease-out',
          animation: phase === 'shake' ? 'koShake 0.1s ease-in-out infinite' : 'none',
        }}
      >
        {/* Main text with multiple layers for depth */}
        <div className="relative">
          {/* Back shadow layer */}
          <div 
            className="absolute text-center font-black"
            style={{
              fontSize: 'clamp(80px, 20vw, 200px)',
              fontFamily: 'Impact, "Arial Black", sans-serif',
              color: '#000',
              textShadow: '0 0 30px rgba(0,0,0,0.8)',
              transform: 'translate(8px, 8px)',
              letterSpacing: '0.05em',
              WebkitTextStroke: '4px #000',
            }}
          >
            {mainText}
          </div>
          
          {/* Middle stroke layer */}
          <div 
            className="absolute text-center font-black"
            style={{
              fontSize: 'clamp(80px, 20vw, 200px)',
              fontFamily: 'Impact, "Arial Black", sans-serif',
              color: isWinner ? '#8B4513' : '#660000',
              transform: 'translate(4px, 4px)',
              letterSpacing: '0.05em',
              WebkitTextStroke: '8px ' + (isWinner ? '#8B4513' : '#660000'),
            }}
          >
            {mainText}
          </div>
          
          {/* Main text layer */}
          <div 
            className="relative text-center font-black"
            style={{
              fontSize: 'clamp(80px, 20vw, 200px)',
              fontFamily: 'Impact, "Arial Black", sans-serif',
              color: mainColor,
              textShadow: `
                0 0 20px ${glowColor},
                0 0 40px ${glowColor},
                0 0 60px ${glowColor},
                0 0 80px ${glowColor}
              `,
              letterSpacing: '0.05em',
              WebkitTextStroke: '2px ' + (isWinner ? '#FFE4B5' : '#FF8888'),
              filter: 'drop-shadow(0 0 10px ' + glowColor + ')',
            }}
          >
            {mainText}
          </div>
        </div>

        {/* Sub text */}
        <div 
          className="text-center mt-4 font-bold"
          style={{
            fontSize: 'clamp(24px, 5vw, 48px)',
            fontFamily: 'Impact, "Arial Black", sans-serif',
            color: '#FFF',
            textShadow: `
              2px 2px 0 #000,
              -2px 2px 0 #000,
              2px -2px 0 #000,
              -2px -2px 0 #000,
              0 0 20px ${glowColor}
            `,
            letterSpacing: '0.2em',
            opacity: phase === 'zoom' ? 0 : 1,
            transform: phase === 'zoom' ? 'translateY(20px)' : 'translateY(0)',
            transition: 'all 0.3s ease-out 0.2s',
          }}
        >
          {subText}
        </div>

        {/* Decorative lines */}
        <div 
          className="absolute left-1/2 -translate-x-1/2 flex gap-2"
          style={{
            bottom: '-40px',
            opacity: phase === 'stable' || phase === 'fadeout' ? 1 : 0,
            transition: 'opacity 0.5s ease-out',
          }}
        >
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              style={{
                width: '20px',
                height: '4px',
                background: mainColor,
                boxShadow: `0 0 10px ${glowColor}`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Corner decorations - KOF style */}
      {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((pos) => (
        <div
          key={pos}
          className="absolute w-32 h-32 pointer-events-none"
          style={{
            [pos.includes('top') ? 'top' : 'bottom']: '20px',
            [pos.includes('left') ? 'left' : 'right']: '20px',
            borderTop: pos.includes('top') ? `4px solid ${mainColor}` : 'none',
            borderBottom: pos.includes('bottom') ? `4px solid ${mainColor}` : 'none',
            borderLeft: pos.includes('left') ? `4px solid ${mainColor}` : 'none',
            borderRight: pos.includes('right') ? `4px solid ${mainColor}` : 'none',
            opacity: phase === 'zoom' ? 0 : 0.8,
            transform: phase === 'zoom' ? 'scale(0.5)' : 'scale(1)',
            transition: 'all 0.3s ease-out 0.1s',
            boxShadow: `0 0 15px ${glowColor}40`,
          }}
        />
      ))}

      {/* Click to skip text */}
      <div 
        className="absolute bottom-8 text-center w-full text-gray-400 text-sm cursor-pointer"
        onClick={onClose}
        style={{
          opacity: phase === 'stable' ? 1 : 0,
          transition: 'opacity 0.3s ease-out',
        }}
      >
        Click anywhere to continue
      </div>

      {/* CSS Keyframes */}
      <style jsx>{`
        @keyframes koShake {
          0%, 100% { transform: translateX(0) scale(1.1); }
          25% { transform: translateX(-5px) rotate(-1deg) scale(1.1); }
          75% { transform: translateX(5px) rotate(1deg) scale(1.1); }
        }
      `}</style>
    </div>
  )
}
