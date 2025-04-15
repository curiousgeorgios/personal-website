"use client"

import { motion } from "framer-motion"
import MediaPlayer from "@/components/MediaPlayer"
import { Track } from "@/hooks/useAudioTracks"

interface AudioPlayerWrapperProps {
  tracks: Track[]
}

export function AudioPlayerWrapper({ tracks }: AudioPlayerWrapperProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.5 }}
      className="fixed top-6 right-6 z-10"
    >
      <MediaPlayer tracks={tracks} autoPlay={true} />
    </motion.div>
  )
} 