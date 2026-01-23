"use client";

interface LoadingModalProps {
  isOpen: boolean;
  message: string;
  canClose?: boolean;
  onClose?: () => void;
}

export function LoadingModal({
  isOpen,
  message,
  canClose = false,
  onClose,
}: LoadingModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 animate-bounce-in">
      <div className="relative">
        <div className="absolute -inset-2 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-3xl blur-xl opacity-50 animate-pulse"></div>

        <div className="relative bg-gradient-to-br from-white to-blue-50 rounded-3xl shadow-2xl px-10 py-8 text-center min-w-[280px] border-4 border-white">
          <div className="flex justify-center mb-5">
            <div className="relative">
              <div className="absolute inset-0 w-20 h-20">
                <div className="absolute inset-0 border-4 border-transparent border-t-blue-500 border-r-purple-500 rounded-full animate-spin"></div>
                <div
                  className="absolute inset-2 border-4 border-transparent border-b-pink-500 border-l-cyan-500 rounded-full animate-spin"
                  style={{
                    animationDirection: "reverse",
                    animationDuration: "1s",
                  }}
                ></div>
              </div>
              <div className="relative w-20 h-20 flex items-center justify-center">
                <div className="text-4xl animate-pulse">⚡</div>
              </div>
            </div>
          </div>

          <p className="text-gray-800 text-lg font-bold mb-2">{message}</p>
          <div className="flex justify-center gap-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
            <div
              className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"
              style={{ animationDelay: "0.1s" }}
            ></div>
            <div
              className="w-2 h-2 bg-pink-500 rounded-full animate-bounce"
              style={{ animationDelay: "0.2s" }}
            ></div>
          </div>

          {/* Close button (only if canClose is true) */}
          {canClose && onClose && (
            <button
              onClick={onClose}
              className="mt-5 px-6 py-2 bg-gradient-to-r from-red-400 to-pink-500 hover:from-red-500 hover:to-pink-600 text-white text-sm font-bold rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all transform active:scale-95"
            >
              ❌ Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
