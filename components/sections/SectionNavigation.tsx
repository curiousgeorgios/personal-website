"use client"

import { motion } from "framer-motion"

// Define possible section types for better type safety
type SectionType = "currently" | "previously" | "best" | "spare" | "interests" | "moodboard" | "connect"

// Define section navigation items
const sectionLabels: Record<string, SectionType> = {
  "Currently": "currently",
  "Previously": "previously",
  "I'm at my best when": "best",
  "In my spare time": "spare",
  "Interests": "interests",
  "Moodboard": "moodboard",
  "Let's connect": "connect",
}

interface SectionNavigationProps {
  activeSection: SectionType
  onSectionChange: (section: SectionType) => void
}

export function SectionNavigation({ activeSection, onSectionChange }: SectionNavigationProps) {
  return (
    <>
      {Object.entries(sectionLabels).map(([label, key], index) => (
        <motion.div
          key={key}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.1 * index }}
        >
          <motion.button
            onClick={() => onSectionChange(key)}
            className={`text-left text-sm md:text-base hover:text-amber-500 transition-colors ${activeSection === key ? "text-amber-500" : ""}`}
            whileHover={{ x: 5 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
          >
            {activeSection === key && (
              <motion.span
                className="inline-block mr-1 text-amber-500"
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
              >•</motion.span>
            )}
            {label}
          </motion.button>
        </motion.div>
      ))}
    </>
  )
} 