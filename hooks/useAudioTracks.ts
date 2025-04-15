import { useState, useEffect } from 'react';

// Define types for audio tracks
export interface Track {
  title: string;
  artist: string;
  src: string;
  artwork: string | null;
}

// Hook for fetching and ordering audio tracks
export function useAudioTracks(): Track[] {
  const [audioTracks, setAudioTracks] = useState<Track[]>([
    // Default track in case API fails
    {
      title: "Loading...",
      artist: "Please wait",
      src: "",
      artwork: null
    }
  ]);

  // Preferred order of audio tracks by filename
  const trackOrder = [
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
        const trackMap = new Map<string, Track>();
        allTracks.forEach((track: Track) => {
          const filename = track.src.split('/').pop();
          if (filename) {
            trackMap.set(filename, track);
          }
        });

        // Create the ordered track list based on the trackOrder array
        const orderedTracks: Track[] = [];

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

  return audioTracks;
} 