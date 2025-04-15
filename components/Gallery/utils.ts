// Types for gallery and photos
export interface Photo {
  src: string;
  caption: string;
  alt?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  index?: number;
}

export type GalleryType = "travel" | "art" | "moments";

// Gallery collections data
export const galleries: Record<GalleryType, Photo[]> = {
  travel: [
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00084.JPG", caption: "The Palace Armoury in Malta" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00135.JPG", caption: "Streets of Malta" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00173.JPG", caption: "Horse taxi in Malta" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00237.JPG", caption: "Yummy mandarin tree in Gozo" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00337.JPG", caption: "Gozo again..." },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00195.JPG", caption: "Cute street plants in Malta" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00405.JPG", caption: "Cool cafe/bakery in Madrid" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00416.JPG", caption: "Picture perfect treat in Madrid" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00420.JPG", caption: "Madrid architecture" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00135.JPG", caption: "Narrow streets in Malta" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00435.JPG", caption: "Jamon!" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00450.JPG", caption: "Madrid cathedral" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00492.JPG", caption: "Royal Palace of Madrid" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00544.JPG", caption: "Retiro Park" },
  ],
  art: [
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/DSC00569.JPG", caption: "Julia" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/IMG_5560.jpeg", caption: "Elizabeth Gower, Then and now" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/IMG_5561.jpeg", caption: "John Brack, The Battle" },
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/IMG_5670.jpeg", caption: "The Getty, LA" },
  ],
  moments: [
    { src: "https://curiousgeorge.dev/cdn-cgi/image/width=291,fit=contain/https://assets.curiousgeorge.dev/IMG_6615.jpeg", caption: "AO semifinals 2025" },
  ],
};

// Helper function to determine image class based on aspect ratio or dimensions
export const getImageClass = (photo: Photo): 'horizontal' | 'vertical' | 'square' => {
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

// Helper function to prepare images with aspect ratios and metadata
export const prepareImagesWithMetadata = (images: Photo[]): Photo[] => {
  return images.map((image, index) => {
    // Assign different aspect ratios for visual interest
    const aspectRatios = ['square', '4/3', '3/4', '16/9', '3/2'];
    const randomIndex = (index % aspectRatios.length);
    const aspectRatio = aspectRatios[randomIndex];

    return {
      ...image,
      aspectRatio,
      index,
      alt: image.caption // Default alt text to caption if not provided
    };
  });
};

// Helper function to create optimized image URLs
export const getOptimizedImageUrl = (
  photo: Photo, 
  size: 'thumbnail' | 'full' = 'thumbnail'
): string => {
  if (!photo.src) {
    return size === 'thumbnail' 
      ? '/placeholder.svg?width=400&height=400' 
      : '/placeholder.svg?width=1920&height=1080';
  }

  // Width to use based on size parameter
  const width = size === 'thumbnail' ? 800 : 1920;
  
  // If it's already a CDN URL, replace the width parameter
  if (photo.src.includes('cdn-cgi/image')) {
    return photo.src
      .replace(/width=\d+/, `width=${width}`)
      .replace(/fit=scale-down/, 'fit=contain');
  }
  
  // Otherwise, create a new CDN URL
  return `https://curiousgeorge.dev/cdn-cgi/image/width=${width},fit=contain/${
    photo.src.replace(/^https?:\/\//, 'https://')
  }`;
}; 