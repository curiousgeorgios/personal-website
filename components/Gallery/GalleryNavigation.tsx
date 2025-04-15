"use client"

import { motion } from "framer-motion"
import { ChevronRight } from "lucide-react"
import { GalleryType } from "./utils"

interface GalleryNavigationProps {
  activeGallery: GalleryType
  onGalleryChange: (gallery: GalleryType) => void
}

// Gallery navigation labels
const galleryLabels: Record<string, GalleryType> = {
  "Travel": "travel",
  "Art": "art",
  "Moments": "moments",
}

export function GalleryNavigation({ activeGallery, onGalleryChange }: GalleryNavigationProps) {
  return (
    <div className="flex space-x-4 mb-6">
      {Object.entries(galleryLabels).map(([label, key]) => (
        <motion.button
          key={key}
          onClick={() => onGalleryChange(key)}
          className={`text-xs md:text-sm hover:text-amber-500 transition-colors flex items-center ${activeGallery === key ? "text-amber-500" : ""}`}
          whileHover={{ x: 2 }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          {label}
          {activeGallery === key && (
            <motion.div
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronRight size={14} className="ml-1" />
            </motion.div>
          )}
        </motion.button>
      ))}
    </div>
  )
} 