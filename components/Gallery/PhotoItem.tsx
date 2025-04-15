"use client"

import { motion } from "framer-motion"
import { Photo, getImageClass, getOptimizedImageUrl } from "./utils"

interface PhotoItemProps {
  photo: Photo
  onClick: (photo: Photo) => void
}

export function PhotoItem({ photo, onClick }: PhotoItemProps) {
  return (
    <motion.div
      key={`photo-${photo.index}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1 * ((photo.index || 0) % 6) }}
      className={`group grid-item ${getImageClass(photo)}`}
    >
      <motion.div
        className="relative w-full h-full overflow-hidden cursor-pointer rounded-lg"
        whileHover={{ scale: 1.02 }}
        transition={{ duration: 0.3 }}
        onClick={() => onClick(photo)}
      >
        <img
          src={getOptimizedImageUrl(photo, 'thumbnail')}
          alt={photo.caption}
          className="w-full h-full rounded-lg transition-transform duration-700 group-hover:scale-105 object-cover"
          loading="lazy"
          style={{ display: 'block' }}
        />
        <motion.div
          className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end"
          initial={{ opacity: 0 }}
          whileHover={{ opacity: 1 }}
        >
          <p className="text-white text-sm p-3">{photo.caption}</p>
        </motion.div>
      </motion.div>
    </motion.div>
  )
} 