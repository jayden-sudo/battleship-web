"use client";

import { useState } from "react";

interface CreateGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (stake: string) => void;
}

export function CreateGameModal({
  isOpen,
  onClose,
  onCreate,
}: CreateGameModalProps) {
  const [stake, setStake] = useState("0.0001");
  const presetValues = ["1", "0.1", "0.01", "0.001", "0.0001"];

  if (!isOpen) return null;

  const handleCreate = () => {
    onCreate(stake);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in-up">
      <div className="relative animate-bounce-in">
        <div className="absolute -inset-1 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 rounded-2xl blur-xl opacity-50 animate-pulse"></div>

        <div className="relative bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl border-4 border-white">
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-6xl animate-float">
            🎮
          </div>

          <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600 mb-6 text-center pt-4">
            🎯 Create New Game 🎯
          </h2>

          <div className="space-y-6">
            <div>
              <label className="block text-lg font-bold text-purple-700 mb-3 flex items-center gap-2">
                <span className="text-2xl">💰</span>
                Stake Amount (ETH)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  className="w-full px-4 py-3 text-lg font-bold border-4 border-purple-300 rounded-xl focus:ring-4 focus:ring-purple-400 focus:border-purple-500 bg-white shadow-inner transition-all"
                  placeholder="Enter stake amount"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-2xl">
                  ⚡
                </div>
              </div>
            </div>

            <div>
              <label className="block text-lg font-bold text-purple-700 mb-3 flex items-center gap-2">
                <span className="text-2xl">🎲</span>
                Quick Select
              </label>
              <div className="flex flex-wrap gap-3">
                {presetValues.map((value) => (
                  <button
                    key={value}
                    onClick={() => setStake(value)}
                    className="px-4 py-2 bg-gradient-to-br from-blue-400 to-purple-500 hover:from-blue-500 hover:to-purple-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:scale-110 transition-all transform active:scale-95"
                  >
                    {value} ETH
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 flex gap-4">
            <button
              onClick={onClose}
              className="flex-1 px-6 py-3 bg-gradient-to-br from-gray-300 to-gray-400 hover:from-gray-400 hover:to-gray-500 text-gray-800 font-bold text-lg rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all transform active:scale-95"
            >
              ❌ Cancel
            </button>
            <button
              onClick={handleCreate}
              className="flex-1 px-6 py-3 bg-gradient-to-br from-green-400 via-emerald-500 to-teal-500 hover:from-green-500 hover:via-emerald-600 hover:to-teal-600 text-white font-black text-lg rounded-xl shadow-lg hover:shadow-2xl hover:scale-105 transition-all transform active:scale-95 animate-pulse-glow"
            >
              🚀 Create Game
            </button>
          </div>

          <div
            className="absolute -bottom-4 -right-4 text-5xl opacity-50 animate-float"
            style={{ animationDelay: "0.5s" }}
          >
            ⚓
          </div>
          <div
            className="absolute -top-4 -left-4 text-4xl opacity-50 animate-float"
            style={{ animationDelay: "1s" }}
          >
            🌊
          </div>
        </div>
      </div>
    </div>
  );
}
