import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import * as mm from 'music-metadata';

export async function GET(request: NextRequest) {
  try {
    const audioDir = path.join(process.cwd(), 'public', 'audio');
    const files = fs.readdirSync(audioDir);

    // Filter only MP3 files
    const mp3Files = files.filter(file => file.toLowerCase().endsWith('.mp3'));

    // Process each file to get metadata
    const tracks = await Promise.all(
      mp3Files.map(async (filename) => {
        const filePath = path.join(audioDir, filename);

        try {
          // Read metadata from the file
          const metadata = await mm.parseFile(filePath);

          // Extract relevant information from metadata or filename
          let title = metadata.common.title;
          let artist = metadata.common.artist;
          
          // If metadata doesn't have title/artist, try to extract from filename
          if (!title || !artist) {
            // Check if filename follows "Artist - Title.mp3" format
            const filenameWithoutExt = filename.replace('.mp3', '');
            
            if (filenameWithoutExt.includes(' - ')) {
              const parts = filenameWithoutExt.split(' - ');
              
              // Only override if metadata doesn't already have the value
              if (!artist) artist = parts[0].trim();
              if (!title) title = parts.slice(1).join(' - ').trim();
            } else {
              // If no dash separator, just use the whole filename as title
              if (!title) title = filenameWithoutExt;
            }
          }
          
          // Ensure we have values even if extraction failed
          title = title || filename.replace('.mp3', '');
          artist = artist || 'Unknown Artist';

          // For artwork, just use a reference to the audio file
          // We'll create a separate API endpoint to serve the artwork
          const artwork = `/api/audio/artwork?file=${encodeURIComponent(filename)}`;

          // Create a track object
          const track = {
            title,
            artist,
            src: `/audio/${filename}`,
            artwork
          };

          return track;
        } catch (error) {
          console.error(`Error processing ${filename}:`, error);
          // Return a basic track object if metadata extraction fails
          // Extract title and artist from filename in case of error
          let title, artist;
          
          const filenameWithoutExt = filename.replace('.mp3', '');
          if (filenameWithoutExt.includes(' - ')) {
            const parts = filenameWithoutExt.split(' - ');
            artist = parts[0].trim();
            title = parts.slice(1).join(' - ').trim();
          } else {
            title = filenameWithoutExt;
            artist = 'Unknown Artist';
          }
          
          return {
            title,
            artist,
            src: `/audio/${filename}`,
            artwork: `/api/audio/artwork?file=${encodeURIComponent(filename)}`
          };
        }
      })
    );

    // We're now handling ordering on the client side
    // Just return the tracks as-is
    
    return NextResponse.json(tracks);
  } catch (error) {
    console.error('Error fetching audio files:', error);
    return NextResponse.json({ error: 'Failed to fetch audio files' }, { status: 500 });
  }
}
