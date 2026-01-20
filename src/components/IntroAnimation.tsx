"use client";

import { useState, useEffect, useCallback } from "react";

interface IntroAnimationProps {
  onComplete: () => void;
}

// Pixel art spaceship designs (using CSS)
const spaceships = [
  // Large battleship (center)
  {
    id: "battleship",
    width: 120,
    height: 80,
    delay: 0,
    x: 50, // percentage from left
    pixels: [
      // Main body
      { x: 4, y: 3, w: 4, h: 2 },
      { x: 3, y: 4, w: 6, h: 3 },
      { x: 2, y: 5, w: 8, h: 2 },
      { x: 1, y: 6, w: 10, h: 2 },
      // Wings
      { x: 0, y: 7, w: 2, h: 1 },
      { x: 10, y: 7, w: 2, h: 1 },
      // Engines
      { x: 2, y: 8, w: 2, h: 2, color: "#ff6b00" },
      { x: 5, y: 8, w: 2, h: 2, color: "#ff6b00" },
      { x: 8, y: 8, w: 2, h: 2, color: "#ff6b00" },
      // Cockpit
      { x: 5, y: 2, w: 2, h: 2, color: "#00ffff" },
    ],
  },
  // Left escort
  {
    id: "escort-left",
    width: 60,
    height: 50,
    delay: 0.15,
    x: 25,
    pixels: [
      { x: 2, y: 1, w: 2, h: 1 },
      { x: 1, y: 2, w: 4, h: 2 },
      { x: 0, y: 3, w: 6, h: 2 },
      { x: 1, y: 5, w: 4, h: 1 },
      // Engine
      { x: 2, y: 6, w: 2, h: 1, color: "#ff6b00" },
      // Cockpit
      { x: 2, y: 1, w: 2, h: 1, color: "#00ffff" },
    ],
  },
  // Right escort
  {
    id: "escort-right",
    width: 60,
    height: 50,
    delay: 0.15,
    x: 75,
    pixels: [
      { x: 2, y: 1, w: 2, h: 1 },
      { x: 1, y: 2, w: 4, h: 2 },
      { x: 0, y: 3, w: 6, h: 2 },
      { x: 1, y: 5, w: 4, h: 1 },
      // Engine
      { x: 2, y: 6, w: 2, h: 1, color: "#ff6b00" },
      // Cockpit
      { x: 2, y: 1, w: 2, h: 1, color: "#00ffff" },
    ],
  },
  // Far left fighter
  {
    id: "fighter-left",
    width: 40,
    height: 40,
    delay: 0.3,
    x: 10,
    pixels: [
      { x: 1, y: 0, w: 2, h: 1 },
      { x: 0, y: 1, w: 4, h: 2 },
      { x: 1, y: 3, w: 2, h: 1 },
      // Engine
      { x: 1, y: 4, w: 2, h: 1, color: "#ff6b00" },
    ],
  },
  // Far right fighter
  {
    id: "fighter-right",
    width: 40,
    height: 40,
    delay: 0.3,
    x: 90,
    pixels: [
      { x: 1, y: 0, w: 2, h: 1 },
      { x: 0, y: 1, w: 4, h: 2 },
      { x: 1, y: 3, w: 2, h: 1 },
      // Engine
      { x: 1, y: 4, w: 2, h: 1, color: "#ff6b00" },
    ],
  },
];

const PixelSpaceship = ({
  ship,
  animate,
}: {
  ship: (typeof spaceships)[0];
  animate: boolean;
}) => {
  const pixelSize = ship.width / 12;

  return (
    <div
      className="absolute transition-all duration-1000 ease-out"
      style={{
        width: ship.width,
        height: ship.height,
        left: `${ship.x}%`,
        transform: "translateX(-50%)",
        bottom: animate ? "35%" : "-150px",
        opacity: animate ? 1 : 0,
        transitionDelay: `${ship.delay}s`,
      }}
    >
      {ship.pixels.map((pixel, index) => (
        <div
          key={index}
          className="absolute"
          style={{
            left: pixel.x * pixelSize,
            top: pixel.y * pixelSize,
            width: pixel.w * pixelSize,
            height: pixel.h * pixelSize,
            backgroundColor: pixel.color || "#4ade80",
            boxShadow:
              pixel.color === "#ff6b00"
                ? "0 4px 8px rgba(255, 107, 0, 0.8)"
                : pixel.color === "#00ffff"
                  ? "0 0 4px rgba(0, 255, 255, 0.8)"
                  : "0 2px 4px rgba(74, 222, 128, 0.3)",
          }}
        />
      ))}
      {/* Engine flame animation */}
      {animate && (
        <div
          className="absolute animate-pulse"
          style={{
            bottom: -8,
            left: "50%",
            transform: "translateX(-50%)",
            width: ship.width * 0.6,
            height: 12,
            background:
              "linear-gradient(to bottom, #ff6b00, #ff0000, transparent)",
            filter: "blur(2px)",
          }}
        />
      )}
    </div>
  );
};

// Star background
const StarField = () => {
  const [stars] = useState(() =>
    Array.from({ length: 100 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      animationDelay: Math.random() * 2,
    })),
  );

  return (
    <div className="absolute inset-0 overflow-hidden">
      {stars.map((star) => (
        <div
          key={star.id}
          className="absolute bg-white rounded-full animate-pulse"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.size,
            height: star.size,
            animationDelay: `${star.animationDelay}s`,
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  );
};

export function IntroAnimation({ onComplete }: IntroAnimationProps) {
  const [animate, setAnimate] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  const handleSkip = useCallback(() => {
    if (!fadeOut) {
      setFadeOut(true);
      setTimeout(onComplete, 500);
    }
  }, [fadeOut, onComplete]);

  useEffect(() => {
    // Start animation after a brief delay
    const animateTimer = setTimeout(() => setAnimate(true), 100);

    // Show title after ships arrive
    const titleTimer = setTimeout(() => setShowTitle(true), 800);

    // Auto-complete after 3 seconds
    const completeTimer = setTimeout(() => {
      setFadeOut(true);
      setTimeout(onComplete, 500);
    }, 3000);

    return () => {
      clearTimeout(animateTimer);
      clearTimeout(titleTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  // Skip on any key press
  useEffect(() => {
    const handleKeyDown = () => handleSkip();
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSkip]);

  return (
    <div
      className={`fixed inset-0 z-50 bg-black transition-opacity duration-500 ${
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      onClick={handleSkip}
      style={{ cursor: "pointer" }}
    >
      {/* Star background */}
      <StarField />

      {/* Scan lines effect */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)",
        }}
      />

      {/* Spaceships */}
      {spaceships.map((ship) => (
        <PixelSpaceship key={ship.id} ship={ship} animate={animate} />
      ))}

      {/* Title */}
      <div
        className={`absolute top-1/4 left-1/2 transform -translate-x-1/2 transition-all duration-700 ${
          showTitle ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-8"
        }`}
      >
        <h1
          className="text-6xl md:text-8xl font-bold text-center"
          style={{
            fontFamily: '"Press Start 2P", monospace, system-ui',
            color: "#4ade80",
            textShadow: `
              0 0 10px #4ade80,
              0 0 20px #4ade80,
              0 0 40px #22c55e,
              0 4px 0 #166534
            `,
            letterSpacing: "0.1em",
          }}
        >
          ⚓ Battleship
        </h1>
        <p
          className="text-center mt-4 text-lg md:text-xl"
          style={{
            fontFamily: '"Press Start 2P", monospace, system-ui',
            color: "#60a5fa",
            textShadow: "0 0 10px #3b82f6",
            letterSpacing: "0.05em",
          }}
        >
          ZK BLOCKCHAIN WARFARE
        </p>
      </div>

      {/* Skip hint */}
      <div
        className={`absolute bottom-8 left-1/2 transform -translate-x-1/2 transition-opacity duration-500 ${
          showTitle ? "opacity-100" : "opacity-0"
        }`}
      >
        <p
          className="text-sm animate-pulse"
          style={{
            fontFamily: '"Press Start 2P", monospace, system-ui',
            color: "#9ca3af",
            letterSpacing: "0.1em",
          }}
        >
          CLICK OR PRESS ANY KEY
        </p>
      </div>

      {/* Corner decorations */}
      <div className="absolute top-4 left-4 w-8 h-8 border-l-4 border-t-4 border-green-500" />
      <div className="absolute top-4 right-4 w-8 h-8 border-r-4 border-t-4 border-green-500" />
      <div className="absolute bottom-4 left-4 w-8 h-8 border-l-4 border-b-4 border-green-500" />
      <div className="absolute bottom-4 right-4 w-8 h-8 border-r-4 border-b-4 border-green-500" />
    </div>
  );
}

// Helper function to check if intro should be shown today
export function shouldShowIntro(): boolean {
  if (typeof window === "undefined") return false;

  const STORAGE_KEY = "battleship_intro_last_shown";
  const today = new Date().toDateString();
  const lastShown = localStorage.getItem(STORAGE_KEY);

  if (lastShown === today) {
    return false;
  }

  localStorage.setItem(STORAGE_KEY, today);
  return true;
}
