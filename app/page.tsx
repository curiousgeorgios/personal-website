"use client"

import { useState } from "react"
import { SectionContent } from "@/components/sections/SectionContent"
import { SectionNavigation } from "@/components/sections/SectionNavigation"
import { PhotoGallery } from "@/components/gallery/PhotoGallery" 
import { BackgroundEffects } from "@/components/layout/BackgroundEffects"
import { HeaderLogo } from "@/components/layout/HeaderLogo"
import { AudioPlayerWrapper } from "@/components/audio/AudioPlayerWrapper"
import { useAudioTracks } from "@/hooks/useAudioTracks"

// Define possible section types for better type safety
type SectionType = "currently" | "previously" | "best" | "spare" | "interests" | "connect"
type GalleryType = "travel" | "art" | "moments"

export default function Home() {
  const [activeSection, setActiveSection] = useState<SectionType>("currently")
  const [activeGallery, setActiveGallery] = useState<GalleryType>("travel")
  const audioTracks = useAudioTracks()

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 font-light overflow-x-hidden">
      {/* Background elements */}
      <BackgroundEffects />

      {/* Audio player */}
      <AudioPlayerWrapper tracks={audioTracks} />

      {/* Header with logo */}
      <HeaderLogo />

      <main className="container mx-auto px-6 md:px-12 pb-20">
        <div className="flex flex-col md:flex-row md:gap-12 lg:gap-24">
          {/* Section navigation sidebar */}
          <div className="md:w-1/3 lg:w-1/4 space-y-6 md:space-y-8">
            <SectionNavigation 
              activeSection={activeSection}
              onSectionChange={setActiveSection}
            />
          </div>

          {/* Content area */}
          <div className="md:w-2/3 lg:w-3/4 mt-8 md:mt-0">
            {activeSection === "interests" ? (
              <PhotoGallery 
                activeGallery={activeGallery}
                setActiveGallery={setActiveGallery}
              />
            ) : (
              <SectionContent section={activeSection} />
            )}
          </div>
        </div>
      </main>

      {/* Subtle grain texture overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-20 z-40 bg-noise"></div>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_10%_20%,rgba(255,226,183,0.1)_0%,rgba(255,255,255,0)_80%)]"></div>
      </div>
    </div>
  )
}