"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { motion, AnimatePresence } from "framer-motion"
import { X, ChevronLeft, ChevronRight } from "lucide-react"
import { Photo, galleries, GalleryType, getOptimizedImageUrl } from "./utils"

interface LightboxProps {
  selectedImage: Photo | null
  activeGallery: GalleryType
  onClose: () => void
  onPrevious: (prevIndex: number) => void
  onNext: (nextIndex: number) => void
}

export function Lightbox({ 
  selectedImage, 
  activeGallery, 
  onClose, 
  onPrevious, 
  onNext 
}: LightboxProps) {
  const [isHighResImageLoading, setIsHighResImageLoading] = useState(false)

  // Close lightbox when Escape key is pressed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!selectedImage) return null;

  const currentGallery = galleries[activeGallery];
  const currentIndex = selectedImage.index || 0;
  const totalImages = currentGallery.length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        className="absolute top-4 right-4 z-10"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <button
          className="text-white p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={24} />
        </button>
      </motion.div>

      <div className="relative w-full h-full flex items-center justify-center">
        {/* Previous button */}
        <motion.button
          className="absolute left-4 z-10 text-white p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          onClick={(e) => {
            e.stopPropagation();
            const prevIndex = currentIndex === 0 ? totalImages - 1 : currentIndex - 1;
            onPrevious(prevIndex);
            setIsHighResImageLoading(true);
          }}
        >
          <ChevronLeft size={32} />
        </motion.button>

        {/* Image container */}
        <motion.div
          className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.3 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative" style={{ width: '80vw', height: '80vh' }}>
            {isHighResImageLoading && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="bg-black/50 text-white px-6 py-3 rounded-md flex items-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white mr-3"></div>
                  <span>Loading high-resolution image...</span>
                </div>
              </div>
            )}
            <Image
              src={getOptimizedImageUrl(selectedImage, 'full')}
              alt={selectedImage.alt || selectedImage.caption}
              fill
              className="object-contain"
              sizes="80vw"
              priority
              onLoadingComplete={() => setIsHighResImageLoading(false)}
              onLoadStart={() => setIsHighResImageLoading(true)}
            />
          </div>
          <motion.div
            className="bg-black/50 text-white p-4 text-center mt-2 rounded-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            style={{ maxWidth: '80vw' }}
          >
            <p className="text-lg">{selectedImage.caption}</p>
            <p className="text-sm text-gray-300 mt-1">
              {currentIndex + 1} of {totalImages}
            </p>
          </motion.div>
        </motion.div>

        {/* Next button */}
        <motion.button
          className="absolute right-4 z-10 text-white p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          onClick={(e) => {
            e.stopPropagation();
            const nextIndex = currentIndex === totalImages - 1 ? 0 : currentIndex + 1;
            onNext(nextIndex);
            setIsHighResImageLoading(true);
          }}
        >
          <ChevronRight size={32} />
        </motion.button>
      </div>
    </motion.div>
  )
} 