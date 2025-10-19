"use client"

import { BackgroundEffects } from "@/components/layout/BackgroundEffects"
import { motion } from "framer-motion"
import Link from "next/link"
import ScrambleIn, { ScrambleInHandle } from "@/components/fancy/text/scramble-in"
import { ReadingProgressBar } from "@/components/ui/ReadingProgressBar"
import { MagneticLink } from "@/components/ui/MagneticLink"
import { EnhancedLink } from "@/components/ui/EnhancedLink"
import { ShareButton } from "@/components/ui/ShareButton"
import { useScrollReveal } from "@/hooks/useScrollReveal"
import { useEffect, useRef } from "react"

export default function VideoEditorJobPage() {
  const titleRef = useRef<ScrambleInHandle>(null)
  const lookingForRef = useRef<ScrambleInHandle>(null)
  const offerRef = useRef<ScrambleInHandle>(null)

  // Scroll reveal hooks
  const introReveal = useScrollReveal()
  const lookingForReveal = useScrollReveal()
  const offerReveal = useScrollReveal()

  useEffect(() => {
    // Stagger the animations
    setTimeout(() => titleRef.current?.start(), 200)
    setTimeout(() => lookingForRef.current?.start(), 1000)
    setTimeout(() => offerRef.current?.start(), 1500)
  }, [])
  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 font-light overflow-x-hidden">
      {/* Reading progress bar */}
      <ReadingProgressBar />

      {/* Background elements */}
      <BackgroundEffects />

      <main className="container mx-auto px-6 md:px-12 py-12 md:py-20 relative z-10">
        <div className="max-w-3xl mx-auto">
          {/* Back link and share button */}
          <div className="flex items-center justify-between mb-8">
            <Link
              href="/"
              className="inline-block text-sm underline hover:text-amber-300 transition-colors duration-200"
            >
              ← back to home
            </Link>
            <ShareButton />
          </div>

          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-8"
          >
            {/* Header */}
            <header className="space-y-4">
              <h1 className="text-3xl md:text-4xl font-normal">
                <ScrambleIn
                  ref={titleRef}
                  text="looking for a video editor/grapher"
                  scrambleSpeed={25}
                  scrambledLetterCount={5}
                  autoStart={false}
                  scrambledClassName="text-amber-300/50"
                />
              </h1>
              <p className="text-sm md:text-base leading-relaxed">
                I&apos;m building{" "}
                <a
                  href="https://canberra.events"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-amber-300 transition-colors duration-200"
                >
                  canberra.events
                </a>{" "}
                — a free, public directory of everything happening in Canberra. The vision is simple:
                make it the definitive place to discover what&apos;s on in the city. Every event, every venue,
                all in one place.
              </p>
            </header>

            {/* Main content */}
            <section className="space-y-6">
              <motion.div
                ref={introReveal.ref as any}
                initial={{ opacity: 0, y: 30 }}
                animate={introReveal.isVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
                transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="space-y-4"
              >
                <p className="text-sm md:text-base leading-relaxed">
                  We&apos;re working with venues across Canberra to get their events listed and promoted.
                  The goal is to create a platform that actually helps people find things to do and helps
                  organisers reach their audience. No paywalls, no gatekeeping — just a proper events
                  directory for the city.
                </p>
                <p className="text-sm md:text-base leading-relaxed font-medium">
                  Need someone to help tell this story through video.
                </p>
              </motion.div>

              {/* What I'm looking for */}
              <motion.div
                ref={lookingForReveal.ref as any}
                initial={{ opacity: 0, y: 30 }}
                animate={lookingForReveal.isVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
                transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="space-y-3"
              >
                <h2 className="text-lg md:text-xl font-normal">
                  <ScrambleIn
                    ref={lookingForRef}
                    text="what I'm looking for:"
                    scrambleSpeed={20}
                    scrambledLetterCount={3}
                    autoStart={false}
                    scrambledClassName="text-amber-300/50"
                  />
                </h2>
                <ul className="space-y-2 text-sm md:text-base">
                  <motion.li
                    initial={{ opacity: 0, x: -20 }}
                    animate={lookingForReveal.isVisible ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
                    transition={{ duration: 0.3, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
                  >
                    • someone curious and hungry
                  </motion.li>
                  <motion.li
                    initial={{ opacity: 0, x: -20 }}
                    animate={lookingForReveal.isVisible ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
                    transition={{ duration: 0.3, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="space-y-2"
                  >
                    <span>• can deliver the style of these videos:</span>
                    <ul className="ml-6 space-y-1">
                      <li>
                        -{" "}
                        <EnhancedLink
                          href="https://www.instagram.com/bymaximise/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-amber-300 transition-colors duration-200"
                        >
                          @bymaximise
                        </EnhancedLink>
                      </li>
                      <li>
                        -{" "}
                        <EnhancedLink
                          href="https://www.instagram.com/toshki/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-amber-300 transition-colors duration-200"
                        >
                          @toshki
                        </EnhancedLink>
                      </li>
                      <li>
                        -{" "}
                        <EnhancedLink
                          href="https://www.instagram.com/thefemale/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-amber-300 transition-colors duration-200"
                        >
                          @thefemale
                        </EnhancedLink>
                      </li>
                      <li>
                        -{" "}
                        <EnhancedLink
                          href="https://www.instagram.com/skymography/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-amber-300 transition-colors duration-200"
                        >
                          @skymography
                        </EnhancedLink>
                      </li>
                      <li>
                        -{" "}
                        <EnhancedLink
                          href="https://artlist.io/stock-footage/artist/zed/1082"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-amber-300 transition-colors duration-200"
                        >
                          artlist.io/artist/zed
                        </EnhancedLink>
                      </li>
                    </ul>
                  </motion.li>
                  <motion.li
                    initial={{ opacity: 0, x: -20 }}
                    animate={lookingForReveal.isVisible ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
                    transition={{ duration: 0.3, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                  >
                    • loves design and wants to create some of their best work
                  </motion.li>
                  <motion.li
                    initial={{ opacity: 0, x: -20 }}
                    animate={lookingForReveal.isVisible ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
                    transition={{ duration: 0.3, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="space-y-2"
                  >
                    <span>• smart with tools like:</span>
                    <ul className="ml-6 space-y-1">
                      <li>
                        -{" "}
                        <EnhancedLink
                          href="https://artlist.io/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-amber-300 transition-colors duration-200"
                        >
                          artlist.io
                        </EnhancedLink>
                      </li>
                      <li>
                        -{" "}
                        <EnhancedLink
                          href="https://icon.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-amber-300 transition-colors duration-200"
                        >
                          icon.com
                        </EnhancedLink>
                      </li>
                      <li>
                        -{" "}
                        <EnhancedLink
                          href="https://www.florafauna.ai/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-amber-300 transition-colors duration-200"
                        >
                          florafauna.ai
                        </EnhancedLink>
                      </li>
                      <li>
                        -{" "}
                        <EnhancedLink
                          href="https://frameset.app/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-amber-300 transition-colors duration-200"
                        >
                          frameset.app
                        </EnhancedLink>
                      </li>
                      <li>
                        -{" "}
                        <EnhancedLink
                          href="https://paper.design/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-amber-300 transition-colors duration-200"
                        >
                          paper.design
                        </EnhancedLink>
                      </li>
                    </ul>
                  </motion.li>
                </ul>
              </motion.div>

              {/* What I can offer */}
              <motion.div
                ref={offerReveal.ref as any}
                initial={{ opacity: 0, y: 30 }}
                animate={offerReveal.isVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
                transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="space-y-3"
              >
                <h2 className="text-lg md:text-xl font-normal">
                  <ScrambleIn
                    ref={offerRef}
                    text="what I can offer:"
                    scrambleSpeed={20}
                    scrambledLetterCount={3}
                    autoStart={false}
                    scrambledClassName="text-amber-300/50"
                  />
                </h2>
                <p className="text-sm md:text-base leading-relaxed">
                  I&apos;m self-funding this, so there&apos;s not much budget at the start. But I&apos;m happy
                  to pay what I can or do a service exchange — I can help with dev work, building tools,
                  whatever makes your life easier. Real potential for this to become paid work as we grow.
                  Plus: free coffees/lunches, workspace, and the opportunity to create something meaningful
                  for Canberra.
                </p>
              </motion.div>

              {/* Additional context */}
              <div className="pt-2">
                <p className="text-sm md:text-base leading-relaxed text-stone-600">
                  (I&apos;m also hosting a series of dinners at my place — politics, art, philosophy, STEM —
                  and we&apos;ll want to capture those too.)
                </p>
              </div>

              {/* CTA */}
              <div className="pt-4">
                <p className="text-sm md:text-base">
                  If that sounds good,{" "}
                  <MagneticLink
                    href="https://www.instagram.com/curious.georgios/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-amber-300 transition-colors duration-200 font-medium"
                  >
                    DM me with your best work
                  </MagneticLink>
                  .
                </p>
              </div>
            </section>
          </motion.article>
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
