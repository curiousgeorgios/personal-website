"use client"

interface ImageSkeletonProps {
  imageClass: 'horizontal' | 'vertical' | 'square'
}

export function ImageSkeleton({ imageClass }: ImageSkeletonProps) {
  // Define minimum heights based on aspect ratio for better skeleton appearance
  const minHeight = imageClass === 'horizontal' ? '200px' : 
                   imageClass === 'vertical' ? '300px' : '250px';
                   
  return (
    <div 
      className="absolute inset-0 w-full h-full bg-gray-200 dark:bg-gray-800 animate-pulse rounded-lg flex items-center justify-center overflow-hidden"
      style={{ 
        aspectRatio: imageClass === 'horizontal' ? '16/9' : 
                     imageClass === 'vertical' ? '3/4' : '1/1',
        minHeight
      }}
    >
      {/* Central loading spinner */}
      <div className="w-12 h-12 border-2 border-amber-300 border-t-transparent rounded-full animate-spin z-10"></div>
      
      {/* Placeholder for content */}
      <div className="absolute inset-0 flex flex-col items-center justify-end p-4">
        <div className="h-3 w-2/3 bg-amber-300/50 rounded-full mb-2"></div>
        <div className="h-3 w-1/2 bg-amber-300/50 rounded-full"></div>
      </div>
      
      {/* Background pattern to make the skeleton visually interesting */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-amber-100 to-transparent"></div>
      </div>
    </div>
  )
} 