"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import { ChevronRight, X, ChevronLeft, ChevronUp } from "lucide-react"
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion"
import MediaPlayer from "@/components/MediaPlayer"

// Helper function to determine image class based on aspect ratio or dimensions
const getImageClass = (photo: any) => {
  // If aspect ratio is directly specified
  if (photo.aspectRatio) {
    if (photo.aspectRatio === '16/9' || photo.aspectRatio === '3/2' || photo.aspectRatio === '2/1') {
      return 'horizontal';
    } else if (photo.aspectRatio === '3/4' || photo.aspectRatio === '2/3' || photo.aspectRatio === '9/16') {
      return 'vertical';
    } else {
      return 'square';
    }
  }

  // If width and height are available
  if (photo.width && photo.height) {
    const ratio = photo.width / photo.height;
    if (ratio > 1.2) {
      return 'horizontal';
    } else if (ratio < 0.8) {
      return 'vertical';
    } else {
      return 'square';
    }
  }

  // Default to square if no information is available
  return 'square';
};

export default function Home() {
  const [activeSection, setActiveSection] = useState("interests")
  const [activeGallery, setActiveGallery] = useState("travel")
  const [isLoaded, setIsLoaded] = useState(false)
  const [isHighResImageLoading, setIsHighResImageLoading] = useState(false)
  const [selectedImage, setSelectedImage] = useState<null | { src: string; alt: string; caption: string; index: number }>(null)
  const [visibleImages, setVisibleImages] = useState(6) // Number of initially visible images
  const galleryRef = useRef<HTMLDivElement>(null) // Reference for infinite scroll
  const loadingRef = useRef<HTMLDivElement>(null) // Reference for intersection observer

  // Effect for handling keyboard events (Escape key) when lightbox is open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedImage) {
        setSelectedImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedImage]);



  // For parallax scrolling effect
  const { scrollY } = useScroll()
  const y1 = useTransform(scrollY, [0, 500], [0, 100])
  const y2 = useTransform(scrollY, [0, 500], [0, -100])

  // Audio tracks for the media player
  const [audioTracks, setAudioTracks] = useState([
    // Default tracks in case API fails
    {
      title: "Loading...",
      artist: "Please wait",
      src: "",
      artwork: null
    }
  ]);

  // Preferred order of audio tracks by position (0-based index)
  const trackOrder = [
    // Specify the order by position (0 is first, 1 is second, etc.)
    // This is the order you want your tracks to appear in
    'berlioz, Ted Jasper - nyc in 1940.mp3',
    'home alone. - fling.mp3',
    'home alone. - light it up.mp3',
    'Loom room - simple things.mp3',
    'Juando - No Bad Feelings Today.mp3',
    'Garabato Beats - Vintage Vibes.mp3',
    'dublon - debris.mp3'
  ];

  // Fetch audio tracks from API
  useEffect(() => {
    const fetchAudioTracks = async () => {
      try {
        // First, fetch all available tracks without ordering
        const response = await fetch('/api/audio');

        if (!response.ok) {
          throw new Error('Failed to fetch audio tracks');
        }

        // Get all available tracks
        const allTracks = await response.json();

        if (!allTracks || allTracks.length === 0) {
          return; // No tracks available
        }

        // Create a map of filename to track for easy lookup
        const trackMap = new Map();
        allTracks.forEach(track => {
          const filename = track.src.split('/').pop();
          if (filename) {
            trackMap.set(filename, track);
          }
        });

        // Create the ordered track list based on the trackOrder array
        const orderedTracks = [];

        // First add tracks in the specified order
        trackOrder.forEach(filename => {
          const track = trackMap.get(filename);
          if (track) {
            orderedTracks.push(track);
            trackMap.delete(filename); // Remove from map to avoid duplicates
          }
        });

        // Then add any remaining tracks that weren't in the order list
        trackMap.forEach(track => {
          orderedTracks.push(track);
        });

        // Update state with the ordered tracks
        setAudioTracks(orderedTracks);
      } catch (error) {
        console.error('Error fetching audio tracks:', error);
      }
    };

    fetchAudioTracks();
  }, []);

  const sections = {
    currently: "building onestack.cloud, running digitalnachos.com.au, learning new things",
    previously: "finance and policy, management consulting, swe @ various startups",
    best: "working (i.e. hacking away) together with amazing people",
    spare: "you'll find me at a local bakery/cafe (probably after a run) or on a tennis court",
    interests: "bit of everything but mainly coffee ☕️, running 🏃‍♂️, tennis 🎾 and coding 💻",
    connect: (
      <>
        <a href="mailto:hello@curiousgeorge.dev" className="underline hover:text-amber-300 transition-colors">
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
        </a>
      </>
    ),
  }

  const galleries = {
    travel: [
      { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00084.JPG", caption: "The Palace Armoury in Malta" },
      { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00135.JPG", caption: "Streets of Malta" },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00173.JPG",
        caption: "Horse taxi in Malta",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00237.JPG",
        caption: "Yummy mandarin tree in Gozo",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00337.JPG",
        caption: "Gozo again...",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00195.JPG",
        caption: "Cute street plants in Malta",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00405.JPG",
        caption: "Cool cafe/bakery in Madrid",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00416.JPG",
        caption: "Picture perfect treat in Madrid",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00420.JPG",
        caption: "Madrid architecture",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00135.JPG",
        caption: "Narrow streets in Malta",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00435.JPG",
        caption: "Jamon!",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00450.JPG",
        caption: "Madrid cathedral",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00492.JPG",
        caption: "Royal Palace of Madrid",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00544.JPG",
        caption: "Retiro Park",
      },

    ],
    art: [
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00569.JPG",
        caption: "Julia",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/IMG_5560.jpeg",
        caption: "Elizabeth Gower, Then and now",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/IMG_5561.jpeg",
        caption: "John Brack, The Battle",
      },
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/IMG_5670.jpeg",
        caption: "The Getty, LA",
      },],
    moments: [
      {
        src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/IMG_6615.jpeg",
        caption: "AO semifinals 2025",
      },],
  }

  // No need for column count state with CSS grid

  // Effect for infinite scroll using Intersection Observer
  useEffect(() => {
    // Only set up the observer if we're in the interests section and there are more images to load
    if (activeSection !== "interests" || !loadingRef.current) return;

    const currentGallery = galleries[activeGallery as keyof typeof galleries];
    if (visibleImages >= currentGallery.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // If the loading element is visible and we have more images to show
        if (entries[0].isIntersecting && visibleImages < currentGallery.length) {
          // Add more images (3 at a time)
          setVisibleImages(prev => Math.min(prev + 3, currentGallery.length));
        }
      },
      { threshold: 0.1 } // Trigger when 10% of the element is visible
    );

    observer.observe(loadingRef.current);

    return () => {
      if (loadingRef.current) {
        observer.unobserve(loadingRef.current);
      }
    };
  }, [activeSection, activeGallery, visibleImages, galleries]);

  // Helper function to prepare images with aspect ratios and metadata
  const prepareImagesWithMetadata = (images: any[]) => {
    return images.map((image, index) => {
      // Assign different aspect ratios for visual interest
      const aspectRatios = ['square', '4/3', '3/4', '16/9', '3/2'];
      const randomIndex = (index % aspectRatios.length);
      const aspectRatio = aspectRatios[randomIndex];

      return {
        ...image,
        aspectRatio,
        index
      };
    });
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 font-light overflow-x-hidden">

      {/* Background gradient elements */}
      <motion.div
        className="fixed top-0 right-0 w-[500px] h-[500px] rounded-full bg-amber-100/30 blur-[120px] -z-10"
        style={{ y: y1 }}
      />
      <motion.div
        className="fixed bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-rose-100/20 blur-[100px] -z-10"
        style={{ y: y2 }}
      />


      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.5 }}
        className="fixed top-6 right-6 z-10"
      >
        <MediaPlayer tracks={audioTracks} autoPlay={true} />
      </motion.div>

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

      <motion.div
        className="container mx-auto px-6 md:px-12 pb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.5 }}
      >
        <div className="flex flex-col md:flex-row md:gap-12 lg:gap-24">
          <div className="md:w-1/3 lg:w-1/4 space-y-6 md:space-y-8">
            {Object.entries({
              Currently: "currently",
              Previously: "previously",
              "I'm at my best when": "best",
              "In my spare time": "spare",
              Interests: "interests",
              "Let's connect": "connect",
            }).map(([label, key], index) => (
              <motion.div
                key={key}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.1 * index }}
              >
                <motion.button
                  onClick={() => setActiveSection(key)}
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
          </div>

          <div className="md:w-2/3 lg:w-3/4 mt-8 md:mt-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.5 }}
                className="min-h-[200px]"
              >
                {activeSection === "interests" ? (
                  <div className="space-y-8">
                    <p className="text-sm md:text-base">{sections.interests}</p>

                    <div className="flex space-x-4 mb-6">
                      {Object.entries({
                        Travel: "travel",
                        Art: "art",
                        Moments: "moments",
                      }).map(([label, key]) => (
                        <motion.button
                          key={key}
                          onClick={() => setActiveGallery(key)}
                          className={`text-xs md:text-sm hover:text-amber-500 transition-colors flex items-center ${activeGallery === key ? "text-amber-500" : ""}`}
                          whileHover={{ x: 2 }}
                          transition={{ type: "spring", stiffness: 400, damping: 17 }}
                        >
                          {label}
                          {activeGallery === key && (
                            <motion.div
                              initial={{ opacity: 0, x: -5 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.2 }}
                            >
                              <ChevronRight size={14} className="ml-1" />
                            </motion.div>
                          )}
                        </motion.button>
                      ))}
                    </div>

                    {/* Masonry layout with CSS grid */}
                    <div
                      ref={galleryRef}
                      className="grid-masonry"
                    >
                      {(() => {
                        // Get current gallery and visible items
                        const currentGallery = galleries[activeGallery as keyof typeof galleries];
                        const visibleGalleryItems = prepareImagesWithMetadata(currentGallery.slice(0, visibleImages));

                        // Render grid items
                        return visibleGalleryItems.map((photo: any) => {
                          return (
                            <motion.div
                              key={`photo-${photo.index}`}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.6, delay: 0.1 * (photo.index % 6) }}
                              className={`group grid-item ${getImageClass(photo)}`}
                            >
                              <motion.div
                                className="relative w-full h-full overflow-hidden cursor-pointer rounded-lg"
                                whileHover={{ scale: 1.02 }}
                                transition={{ duration: 0.3 }}
                                onClick={() => {
                                  // For the lightbox, use a high-resolution version (1920px width)
                                  const highResSrc = photo.src
                                    ? photo.src.includes('cdn-cgi/image')
                                      // If it's already a CDN URL, replace the width parameter
                                      ? photo.src.replace(/width=\d+/, 'width=1920').replace(/fit=scale-down/, 'fit=contain')
                                      // Otherwise, create a new CDN URL
                                      : `https://curiousgeorge.dev/cdn-cgi/image/width=1920,fit=contain/${photo.src.replace(/^https?:\/\//, 'https://')}`
                                    : '/placeholder.svg?width=1920&height=1080';

                                  setSelectedImage({
                                    ...photo,
                                    src: highResSrc,
                                    index: photo.index
                                  });
                                  setIsHighResImageLoading(true);
                                }}
                              >
                                <img
                                  src={
                                    // Modify the image URL to use the CDN pattern
                                    photo.src
                                      ? photo.src.includes('cdn-cgi/image')
                                        // If it's already a CDN URL, replace the width parameter
                                        ? photo.src.replace(/width=\d+/, 'width=800').replace(/fit=scale-down/, 'fit=contain')
                                        // Otherwise, create a new CDN URL
                                        : `https://curiousgeorge.dev/cdn-cgi/image/width=800,fit=contain/${photo.src.replace(/^https?:\/\//, 'https://')}`
                                      : '/placeholder.svg?width=400&height=400'
                                  }
                                  alt={photo.caption}
                                  className="w-full h-full rounded-lg transition-transform duration-700 group-hover:scale-105 object-cover"
                                  loading="lazy"
                                  style={{ display: 'block' }}
                                />
                                <motion.div
                                  className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end"
                                  initial={{ opacity: 0 }}
                                  whileHover={{ opacity: 1 }}
                                >
                                  <p className="text-white text-sm p-3">{photo.caption}</p>
                                </motion.div>
                              </motion.div>
                            </motion.div>
                          );
                        });
                      })()}
                    </div>

                    {/* Loading indicator for infinite scroll */}
                    {visibleImages < galleries[activeGallery as keyof typeof galleries].length && (
                      <div
                        ref={loadingRef}
                        className="mt-6 py-4 flex justify-center items-center"
                      >
                        <div className="animate-pulse flex space-x-2">
                          <div className="h-2 w-2 bg-amber-300 rounded-full"></div>
                          <div className="h-2 w-2 bg-amber-300 rounded-full animation-delay-200"></div>
                          <div className="h-2 w-2 bg-amber-300 rounded-full animation-delay-400"></div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm md:text-base">{sections[activeSection as keyof typeof sections]}</p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* Lightbox for full-screen image viewing */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
            onClick={() => setSelectedImage(null)}
          >
            <motion.div
              className="absolute top-4 right-4 z-10"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <button
                className="text-white p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedImage(null);
                }}
              >
                <X size={24} />
              </button>
            </motion.div>

            <div className="relative w-full h-full flex items-center justify-center">
              {/* Previous button */}
              <motion.button
                className="absolute left-4 z-10 text-white p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  const currentGallery = galleries[activeGallery as keyof typeof galleries];
                  const prevIndex = selectedImage.index === 0 ? currentGallery.length - 1 : selectedImage.index - 1;

                  // Get the photo and create high-res URL
                  const prevPhoto = currentGallery[prevIndex];
                  const highResSrc = prevPhoto.src
                    ? prevPhoto.src.includes('cdn-cgi/image')
                      // If it's already a CDN URL, replace the width parameter
                      ? prevPhoto.src.replace(/width=\d+/, 'width=1920').replace(/fit=scale-down/, 'fit=contain')
                      // Otherwise, create a new CDN URL
                      : `https://curiousgeorge.dev/cdn-cgi/image/width=1920,fit=contain/${prevPhoto.src.replace(/^https?:\/\//, '')}`
                    : '/placeholder.svg?width=1920&height=1080';

                  setSelectedImage({ ...prevPhoto, src: highResSrc, index: prevIndex });
                  setIsHighResImageLoading(true);
                }}
              >
                <ChevronLeft size={32} />
              </motion.button>

              {/* Image container */}
              <motion.div
                className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
              >
                <div className="relative" style={{ width: '80vw', height: '80vh' }}>
                  {isHighResImageLoading && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                      <div className="bg-black/50 text-white px-6 py-3 rounded-md flex items-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-white mr-3"></div>
                        <span>Loading high-resolution image...</span>
                      </div>
                    </div>
                  )}
                  <Image
                    src={selectedImage.src} // We're already setting the high-res src when selecting the image
                    alt={selectedImage.alt}
                    fill
                    className="object-contain"
                    sizes="80vw"
                    priority
                    onLoadingComplete={() => setIsHighResImageLoading(false)}
                    onLoadStart={() => setIsHighResImageLoading(true)}
                  />
                </div>
                <motion.div
                  className="bg-black/50 text-white p-4 text-center mt-2 rounded-sm"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  style={{ maxWidth: '80vw' }}
                >
                  <p className="text-lg">{selectedImage.caption}</p>
                  <p className="text-sm text-gray-300 mt-1">
                    {selectedImage.index + 1} of {galleries[activeGallery as keyof typeof galleries].length}
                  </p>
                </motion.div>
              </motion.div>

              {/* Next button */}
              <motion.button
                className="absolute right-4 z-10 text-white p-2 rounded-full bg-black/30 hover:bg-black/50 transition-colors"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  const currentGallery = galleries[activeGallery as keyof typeof galleries];
                  const nextIndex = selectedImage.index === currentGallery.length - 1 ? 0 : selectedImage.index + 1;

                  // Get the photo and create high-res URL
                  const nextPhoto = currentGallery[nextIndex];
                  const highResSrc = nextPhoto.src
                    ? nextPhoto.src.includes('cdn-cgi/image')
                      // If it's already a CDN URL, replace the width parameter
                      ? nextPhoto.src.replace(/width=\d+/, 'width=1920').replace(/fit=scale-down/, 'fit=contain')
                      // Otherwise, create a new CDN URL
                      : `https://curiousgeorge.dev/cdn-cgi/image/width=1920,fit=contain/${nextPhoto.src.replace(/^https?:\/\//, '')}`
                    : '/placeholder.svg?width=1920&height=1080';

                  setSelectedImage({ ...nextPhoto, src: highResSrc, index: nextIndex });
                  setIsHighResImageLoading(true);
                }}
              >
                <ChevronRight size={32} />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subtle grain texture overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-20 z-40 bg-noise"></div>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_10%_20%,rgba(255,226,183,0.1)_0%,rgba(255,255,255,0)_80%)]"></div>
      </div>
    </div>
  )
}