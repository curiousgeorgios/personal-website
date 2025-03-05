"use client"

import { useState, useEffect, useRef } from "react"
import { Play, Pause, SkipBack, SkipForward } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import Image from "next/image"

interface Track {
  title: string
  src: string
  artist: string
  artwork?: string | null
}

interface MediaPlayerProps {
  tracks: Track[]
  initialVolume?: number
  autoPlay?: boolean
  darkMode?: boolean
}

export default function MediaPlayer({
  tracks,
  initialVolume = 0.7,
  autoPlay = false,
  darkMode = true
}: MediaPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(autoPlay)
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(initialVolume)
  const [isExpanded, setIsExpanded] = useState(false)

  const audioRef = useRef<HTMLAudioElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)

  const currentTrack = tracks[currentTrackIndex]

  // Format time in MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`
  }

  // Handle track ended
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleEnded = () => {
      if (currentTrackIndex < tracks.length - 1) {
        // Play next track
        setCurrentTrackIndex(prev => prev + 1)
      } else {
        // Start from beginning
        setCurrentTrackIndex(0)
        setIsPlaying(false)
      }
    }

    audio.addEventListener('ended', handleEnded)
    return () => {
      audio.removeEventListener('ended', handleEnded)
    }
  }, [currentTrackIndex, tracks.length])

  // Update progress and duration
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateProgress = () => {
      setProgress(audio.currentTime)
    }

    const updateDuration = () => {
      setDuration(audio.duration)
    }

    audio.addEventListener('timeupdate', updateProgress)
    audio.addEventListener('loadedmetadata', updateDuration)

    return () => {
      audio.removeEventListener('timeupdate', updateProgress)
      audio.removeEventListener('loadedmetadata', updateDuration)
    }
  }, [])

  // Handle play/pause
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.play().catch(error => {
        console.error("Playback failed:", error)
        setIsPlaying(false)
      })
    } else {
      audio.pause()
    }
  }, [isPlaying, currentTrackIndex])

  // Handle autoplay
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !autoPlay) return

    audio.play().catch(error => {
      console.error("Autoplay failed:", error)
      setIsPlaying(false)
    })
  }, [autoPlay])

  const togglePlay = () => {
    setIsPlaying(!isPlaying)
  }

  const playPrevious = () => {
    setCurrentTrackIndex(prev => (prev === 0 ? tracks.length - 1 : prev - 1))
  }

  const playNext = () => {
    setCurrentTrackIndex(prev => (prev === tracks.length - 1 ? 0 : prev + 1))
  }

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    const progressBar = progressBarRef.current
    if (!audio || !progressBar) return

    const rect = progressBar.getBoundingClientRect()
    const clickPosition = (e.clientX - rect.left) / rect.width
    const newTime = clickPosition * duration

    audio.currentTime = newTime
    setProgress(newTime)
  }

  const selectTrack = (index: number) => {
    setCurrentTrackIndex(index)
    setIsPlaying(true)
  }

  return (
    <div
      ref={playerRef}
      className={`relative ${darkMode ? 'text-white' : 'text-black'} w-[300px]`}
    >
      <audio
        ref={audioRef}
        src={currentTrack.src}
        preload="metadata"
      />

      <motion.div
        className={`rounded-xl overflow-hidden shadow-lg ${darkMode ? 'bg-gray-800/90' : 'bg-gray-200/90'} backdrop-blur-md`}
        initial={false}
        animate={isExpanded ? "expanded" : "collapsed"}
        onHoverStart={() => setIsExpanded(true)}
        onHoverEnd={() => setIsExpanded(false)}
        variants={{
          collapsed: { height: "auto" },
          expanded: { height: "auto" }
        }}
      >
        {/* Compact Player (Always Visible) */}
        <div className="flex items-center p-3">
          {/* Album Art */}
          <div className="relative w-12 h-12 rounded-md overflow-hidden mr-3">
            {currentTrack.artwork ? (
              <Image
                src={currentTrack.artwork}
                alt={currentTrack.title}
                width={48}
                height={48}
                className="object-cover"
                unoptimized={typeof currentTrack.artwork === 'string' && currentTrack.artwork.startsWith('data:')}
              />
            ) : (
              <div className={`w-full h-full flex items-center justify-center ${darkMode ? 'bg-zinc-700' : 'bg-zinc-300'}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 18V6L21 3V15" stroke={darkMode ? "white" : "black"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="6" cy="18" r="3" stroke={darkMode ? "white" : "black"} strokeWidth="1.5" />
                  <circle cx="18" cy="15" r="3" stroke={darkMode ? "white" : "black"} strokeWidth="1.5" />
                </svg>
              </div>
            )}
          </div>

          {/* Track Info */}
          <div className="flex-1 mr-4">
            <div className="font-medium text-sm truncate">{currentTrack.title}</div>
            <div className="text-xs opacity-70 truncate">{currentTrack.artist || 'Unknown Artist'}</div>
          </div>

          {/* Compact Controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={togglePlay}
              className={`rounded-full w-8 h-8 flex items-center justify-center ${darkMode ? 'bg-white text-black' : 'bg-black text-white'}`}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            </button>

            <button
              onClick={playNext}
              className="opacity-70 hover:opacity-100 transition-opacity"
              aria-label="Next track"
            >
              <SkipForward size={16} />
            </button>
          </div>
        </div>

        {/* Progress Bar (Always Visible) */}
        <div
          ref={progressBarRef}
          className={`h-1 ${darkMode ? 'bg-zinc-700' : 'bg-zinc-300'} cursor-pointer relative`}
          onClick={handleProgressClick}
        >
          <div
            className={`h-full ${darkMode ? 'bg-white' : 'bg-black'} rounded-full`}
            style={{ width: `${(progress / duration) * 100}%` }}
          />
        </div>

        {/* Expanded View */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >

              {/* Time Display */}
              <div className="flex justify-between text-xs opacity-70 px-4 mt-1">
                <span>{formatTime(progress)}</span>
                <span>{formatTime(duration)}</span>
              </div>

              {/* Expanded Controls */}
              <div className="flex justify-center items-center space-x-8 mt-4 mb-4">
                <button
                  onClick={playPrevious}
                  className="opacity-70 hover:opacity-100 transition-opacity"
                  aria-label="Previous track"
                >
                  <SkipBack size={24} />
                </button>

                <button
                  onClick={togglePlay}
                  className={`rounded-full w-12 h-12 flex items-center justify-center ${darkMode ? 'bg-white text-black' : 'bg-black text-white'}`}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
                </button>

                <button
                  onClick={playNext}
                  className="opacity-70 hover:opacity-100 transition-opacity"
                  aria-label="Next track"
                >
                  <SkipForward size={24} />
                </button>
              </div>

              {/* Track List */}
              <div className={`mt-2 ${darkMode ? 'border-t border-gray-700' : 'border-t border-gray-300'}`}>
                <div className="py-2 px-4 text-xs font-medium uppercase opacity-70">Up Next</div>
                <div className="max-h-48 overflow-y-auto">
                  {tracks.map((track, index) => (
                    <div
                      key={index}
                      onClick={() => selectTrack(index)}
                      className={`flex items-center p-2 px-4 cursor-pointer ${currentTrackIndex === index
                        ? (darkMode ? 'bg-gray-700' : 'bg-gray-300')
                        : 'hover:bg-opacity-50 hover:bg-gray-700'
                        }`}
                    >
                      <div className="relative w-8 h-8 rounded overflow-hidden mr-3">
                        {track.artwork ? (
                          <Image
                            src={track.artwork}
                            alt={track.title}
                            width={32}
                            height={32}
                            className="object-cover"
                            unoptimized={typeof track.artwork === 'string' && track.artwork.startsWith('data:')}
                          />
                        ) : (
                          <div className={`w-full h-full flex items-center justify-center ${darkMode ? 'bg-zinc-700' : 'bg-zinc-300'}`}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M9 18V6L21 3V15" stroke={darkMode ? "white" : "black"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx="6" cy="18" r="3" stroke={darkMode ? "white" : "black"} strokeWidth="1.5" />
                              <circle cx="18" cy="15" r="3" stroke={darkMode ? "white" : "black"} strokeWidth="1.5" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-sm truncate">{track.title}</div>
                        <div className="text-xs opacity-70 truncate">{track.artist || 'Unknown Artist'}</div>
                      </div>
                      {currentTrackIndex === index && isPlaying && (
                        <div className="w-4 h-4 flex items-center justify-center">
                          <span className="block w-1 h-1 rounded-full bg-current animate-pulse"></span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}