"use client"

import { motion, useScroll, useTransform } from "framer-motion"

export function BackgroundEffects() {
  // For parallax scrolling effect
  const { scrollY } = useScroll()
  const y1 = useTransform(scrollY, [0, 500], [0, 100])
  const y2 = useTransform(scrollY, [0, 500], [0, -100])

  return (
    <>
      {/* Background gradient elements */}
      <motion.div
        className="fixed top-0 right-0 w-[500px] h-[500px] rounded-full bg-amber-100/30 blur-[120px] -z-10"
        style={{ y: y1 }}
      />
      <motion.div
        className="fixed bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-rose-100/20 blur-[100px] -z-10"
        style={{ y: y2 }}
      />
    </>
  )
} 