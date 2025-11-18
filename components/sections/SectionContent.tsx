"use client";

import { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Define possible section types for better type safety
type SectionType =
  | "currently"
  | "previously"
  | "best"
  | "spare"
  | "interests"
  | "moodboard"
  | "connect";

// Define section contents
const sections: Record<SectionType, ReactNode> = {
  currently: (
    <ul className="space-y-1 text-sm md:text-base">
      <li>
        • scaling{" "}
        <a
          href="https://digitalnachos.com.au"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-300 transition-colors"
        >
          digitalnachos.com.au
        </a>
      </li>
      <li>
        • building{" "}
        <a
          href="https://linear.gratis"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-300 transition-colors"
        >
          linear.gratis
        </a>
      </li>
      <li>
        • looking for cool people to build things with (reach out if you're
        interested)
      </li>
      <li>
        • helping{" "}
        <a
          href="https://runningforresilience.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-300 transition-colors"
        >
          R4R
        </a>{" "}
        to scale through technology
      </li>
      <li>
        • making canberra the best place in the world (see{" "}
        <a
          href="https://canberra.events"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-300 transition-colors"
        >
          canberra.events
        </a>{" "}
        for more and follow{" "}
        <a
          href="https://www.instagram.com/project.canberra"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-300 transition-colors"
        >
          @project.canberra
        </a>{" "}
        on instagram)
      </li>
      <li>• enjoying life to the fullest and always learning</li>
    </ul>
  ),
  previously: (
    <ul className="space-y-1 text-sm md:text-base">
      <li>
        • founded (and built){" "}
        <a
          href="https://onestack.cloud"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-300 transition-colors"
        >
          onestack.cloud
        </a>
      </li>
      <li>
        •{" "}
        <a
          href="https://blocksolveinfrastructure.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-300 transition-colors"
        >
          blocksolveinfrastructure.com
        </a>
      </li>
      <li>• dev/data @ various startups</li>
      <li>
        •{" "}
        <a
          href="https://shecreatesmgmt.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-amber-300 transition-colors"
        >
          shecreatesmgmt.com
        </a>
      </li>
      <li>• finance and policy</li>
      <li>• management consulting @ KPMG</li>
    </ul>
  ),
  best: "working (i.e. hacking away) together with amazing people",
  spare:
    "you'll find me at a local bakery/cafe (probably after a run) or on a tennis court",
  interests:
    "bit of everything but mainly coffee ☕️, running 🏃‍♂️, tennis 🎾 coding 💻 and design 🎨",
  moodboard: (
    <div className="w-full max-w-4xl">
      <iframe
        style={{ border: "1px solid rgba(0, 0, 0, 0.1)" }}
        width="100%"
        height="450"
        src="https://embed.figma.com/board/3sNbsAI1C6tHmUTab4I6vO/Moodboard?node-id=0-1&embed-host=share"
        allowFullScreen
        className="rounded-lg shadow-lg"
      />
    </div>
  ),
  connect: (
    <>
      <a
        href="mailto:hello@curiousgeorge.dev"
        className="underline hover:text-amber-300 transition-colors"
      >
        email
      </a>{" "}
      |{" "}
      <a
        href="https://www.linkedin.com/in/george-vl/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-amber-300 transition-colors"
      >
        linkedin
      </a>{" "}
      |{" "}
      <a
        href="https://t.me/imcuriousgeorge"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-amber-300 transition-colors"
      >
        telegram
      </a>{" "}
      |{" "}
      <a
        href="https://www.instagram.com/curious.georgios/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-amber-300 transition-colors"
      >
        instagram
      </a>
    </>
  ),
};

interface SectionContentProps {
  section: SectionType;
}

export function SectionContent({ section }: SectionContentProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={section}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.5 }}
        className="min-h-[200px]"
      >
        <div className="text-sm md:text-base">{sections[section]}</div>
      </motion.div>
    </AnimatePresence>
  );
}
