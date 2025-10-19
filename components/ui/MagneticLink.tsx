"use client"

import { motion } from "framer-motion"
import { useRef, useState } from "react"

interface MagneticLinkProps {
  href: string
  children: React.ReactNode
  className?: string
  target?: string
  rel?: string
}

export function MagneticLink({
  href,
  children,
  className = "",
  target,
  rel,
}: MagneticLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  const handleMouseMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!ref.current) return

    const rect = ref.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    const x = e.clientX - centerX
    const y = e.clientY - centerY

    // Increased strength for more noticeable effect
    const strength = 0.4
    setPosition({ x: x * strength, y: y * strength })
  }

  const handleMouseLeave = () => {
    setPosition({ x: 0, y: 0 })
  }

  return (
    <motion.a
      ref={ref}
      href={href}
      target={target}
      rel={rel}
      className={`inline-block ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ x: position.x, y: position.y }}
      transition={{
        type: "spring",
        stiffness: 400,
        damping: 25,
        mass: 0.2,
      }}
    >
      {children}
    </motion.a>
  )
}
