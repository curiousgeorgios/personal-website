import { Metadata } from "next"

export const metadata: Metadata = {
  title: "looking for a video editor/grapher | curious george",
  description: "Seeking a curious and hungry video editor/grapher to help capture dinners, events, and conversations across Canberra. Help make Canberra the best place in the world.",
  openGraph: {
    title: "looking for a video editor/grapher",
    description: "Seeking a curious and hungry video editor/grapher to help capture dinners, events, and conversations across Canberra.",
  },
}

export default function VideoEditorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
