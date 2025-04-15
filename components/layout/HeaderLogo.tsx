"use client"

import Image from "next/image"
import { motion } from "framer-motion"

export function HeaderLogo() {
  return (
    <motion.header
      className="p-8 md:p-12"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.5 }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          duration: 1.2,
          delay: 0.2,
          type: "spring",
          stiffness: 200
        }}
        whileHover={{ scale: 1.05 }}
        className="relative inline-block"
      >
        <div className="relative inline-block rounded-full overflow-hidden w-16 h-16 md:w-24 md:h-24">
          <Image
            src="https://assets.curiousgeorge.dev/logo.jpeg"
            alt="Curious George Logo"
            fill
            sizes="(max-width: 768px) 64px, 96px"
            className="object-cover z-10"
          />
        </div>
        <motion.div
          className="absolute -inset-1 rounded-full bg-amber-200/30 blur-sm -z-10"
          animate={{
            scale: [1, 1.05, 1],
          }}
          transition={{
            repeat: Infinity,
            duration: 3,
            ease: "easeInOut"
          }}
        />
      </motion.div>
    </motion.header>
  )
} 