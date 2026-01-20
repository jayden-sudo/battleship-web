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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Create New Game
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Stake Amount (ETH)
            </label>
            <input
              type="text"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter stake amount"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Quick Select
            </label>
            <div className="flex flex-wrap gap-2">
              {presetValues.map((value) => (
                <button
                  key={value}
                  onClick={() => setStake(value)}
                  className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors"
                >
                  {value} ETH
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Create Game
          </button>
        </div>
      </div>
    </div>
  );
}
