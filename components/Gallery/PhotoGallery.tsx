"use client"

import { useState, useRef, useEffect } from "react"
import { AnimatePresence } from "framer-motion"
import { GalleryType, galleries, Photo, prepareImagesWithMetadata } from "./utils"
import { GalleryNavigation } from "./GalleryNavigation"
import { PhotoItem } from "./PhotoItem"
import { Lightbox } from "./Lightbox"
import { SectionContent } from "../sections/SectionContent"

interface PhotoGalleryProps {
  activeGallery: GalleryType
  setActiveGallery: (gallery: GalleryType) => void
}

export function PhotoGallery({ activeGallery, setActiveGallery }: PhotoGalleryProps) {
  const [selectedImage, setSelectedImage] = useState<Photo | null>(null)
  const [visibleImages, setVisibleImages] = useState(6) // Number of initially visible images
  const galleryRef = useRef<HTMLDivElement>(null) // Reference for gallery container
  const loadingRef = useRef<HTMLDivElement>(null) // Reference for intersection observer

  // Effect for infinite scroll using Intersection Observer
  useEffect(() => {
    // Only set up the observer if there are more images to load
    if (!loadingRef.current) return;

    const currentGallery = galleries[activeGallery];
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
  }, [activeGallery, visibleImages]);

  // Handle image selection for lightbox
  const handleSelectImage = (photo: Photo) => {
    setSelectedImage(photo);
  };

  // Handle lightbox navigation and closing
  const handleCloseLightbox = () => setSelectedImage(null);
  
  const handlePreviousImage = (prevIndex: number) => {
    const currentGallery = galleries[activeGallery];
    const prevPhoto = currentGallery[prevIndex];
    setSelectedImage({
      ...prevPhoto,
      index: prevIndex,
      alt: prevPhoto.caption // Default alt to caption if not provided
    });
  };
  
  const handleNextImage = (nextIndex: number) => {
    const currentGallery = galleries[activeGallery];
    const nextPhoto = currentGallery[nextIndex];
    setSelectedImage({
      ...nextPhoto,
      index: nextIndex,
      alt: nextPhoto.caption // Default alt to caption if not provided
    });
  };

  // Get visible images from current gallery
  const currentGallery = galleries[activeGallery];
  const visibleGalleryItems = prepareImagesWithMetadata(
    currentGallery.slice(0, visibleImages)
  );

  return (
    <div className="space-y-8">
      {/* Introduction text */}
      <SectionContent section="interests" />
      
      {/* Gallery navigation */}
      <GalleryNavigation
        activeGallery={activeGallery}
        onGalleryChange={setActiveGallery}
      />

      {/* Masonry layout with CSS grid */}
      <div ref={galleryRef} className="grid-masonry">
        {visibleGalleryItems.map((photo) => (
          <PhotoItem
            key={`photo-${photo.index}`}
            photo={photo}
            onClick={handleSelectImage}
          />
        ))}
      </div>

      {/* Loading indicator for infinite scroll */}
      {visibleImages < currentGallery.length && (
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

      {/* Lightbox for full-screen image viewing */}
      <AnimatePresence>
        {selectedImage && (
          <Lightbox
            selectedImage={selectedImage}
            activeGallery={activeGallery}
            onClose={handleCloseLightbox}
            onPrevious={handlePreviousImage}
            onNext={handleNextImage}
          />
        )}
      </AnimatePresence>
    </div>
  )
} 