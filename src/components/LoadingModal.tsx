'use client'

interface LoadingModalProps {
  isOpen: boolean
  message: string
  canClose?: boolean
  onClose?: () => void
}

export function LoadingModal({ isOpen, message, canClose = false, onClose }: LoadingModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50">
      <div className="bg-white bg-opacity-95 backdrop-blur-sm rounded-2xl shadow-2xl px-8 py-6 text-center min-w-[200px]">
        {/* Spinner */}
        <div className="flex justify-center mb-3">
          <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
        </div>
        
        {/* Message */}
        <p className="text-gray-700 text-sm font-medium">{message}</p>
        
        {/* Close button (only if canClose is true) */}
        {canClose && onClose && (
          <button
            onClick={onClose}
            className="mt-3 px-4 py-1.5 bg-gray-500 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
          >
            Close
          </button>
        )}
      </div>
    </div>
  )
}
