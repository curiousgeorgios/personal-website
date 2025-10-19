"use client"

import { motion } from "framer-motion"
import { useState } from "react"

interface EnhancedLinkProps {
  href: string
  children: React.ReactNode
  className?: string
  target?: string
  rel?: string
}

export function EnhancedLink({
  href,
  children,
  className = "",
  target,
  rel,
}: EnhancedLinkProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <motion.a
      href={href}
      target={target}
      rel={rel}
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileHover={{ scale: 1.05 }}
      transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {children}
      {/* Animated underline */}
      <motion.span
        className="absolute left-0 bottom-0 h-[1px] bg-amber-300"
        initial={{ width: "100%" }}
        animate={{ width: isHovered ? "100%" : "100%", scaleX: isHovered ? 1.1 : 1 }}
        transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
      />
    </motion.a>
  )
}
