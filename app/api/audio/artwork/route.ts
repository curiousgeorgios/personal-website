import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import * as mm from 'music-metadata';

// Default placeholder image as base64 - a simple music note icon
const DEFAULT_IMAGE_BASE64 = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNOSAxOFY2TDIxIDNWMTUiIHN0cm9rZT0iYmxhY2siIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIC8+PGNpcmNsZSBjeD0iNiIgY3k9IjE4IiByPSIzIiBzdHJva2U9ImJsYWNrIiBzdHJva2Utd2lkdGg9IjEuNSIgLz48Y2lyY2xlIGN4PSIxOCIgY3k9IjE1IiByPSIzIiBzdHJva2U9ImJsYWNrIiBzdHJva2Utd2lkdGg9IjEuNSIgLz48L3N2Zz4=';

export async function GET(request: NextRequest) {
  // Get the file parameter from the URL
  const searchParams = request.nextUrl.searchParams;
  const file = searchParams.get('file');
  
  // If no file parameter is provided, return a 400 error
  if (!file) {
    return new NextResponse('Missing file parameter', { status: 400 });
  }
  
  try {
    // Construct the path to the audio file
    const audioDir = path.join(process.cwd(), 'public', 'audio');
    const filePath = path.join(audioDir, file);
    
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      return new NextResponse('File not found', { status: 404 });
    }
    
    // Read metadata from the file
    const metadata = await mm.parseFile(filePath);
    
    // Check if the file has artwork
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const picture = metadata.common.picture[0];
      
      // Ensure we have a valid MIME type
      const format = picture.format && picture.format.startsWith('image/') 
        ? picture.format 
        : 'image/jpeg';
      
      // Return the artwork as an image
      return new NextResponse(picture.data, {
        headers: {
          'Content-Type': format,
          'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        },
      });
    }
    
    // If no artwork is found, redirect to a default image
    // First, check if we have a default.jpg in the public/images directory
    const defaultImagePath = path.join(process.cwd(), 'public', 'images', 'default-album-art.jpg');
    if (fs.existsSync(defaultImagePath)) {
      // If we have a default image, redirect to it
      return NextResponse.redirect(new URL('/images/default-album-art.jpg', request.url));
    }
    
    // If no default image exists, return a simple SVG placeholder
    // Decode the base64 SVG
    const base64Data = DEFAULT_IMAGE_BASE64.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');
    
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      },
    });
    
  } catch (error) {
    console.error('Error extracting artwork:', error);
    return new NextResponse('Error extracting artwork', { status: 500 });
  }
}
