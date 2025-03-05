# Audio Files for Media Player

This directory contains audio files for the custom media player on the personal website.

## Current Audio Files

1. **ambient-melody.mp3** - Ambient background music
2. **chill-vibes.mp3** - Relaxing chill music
3. **soft-piano.mp3** - Soft piano instrumental

## Adding New Audio Files

To add new audio files:

1. Place MP3 files in this directory
2. Update the `audioTracks` array in `app/page.tsx` with the new file information:

```javascript
const audioTracks = [
  {
    title: "Your Track Title",
    src: "/audio/your-file-name.mp3"
  },
  // ... other tracks
]
```

## Audio File Sources

The sample audio files are from [SoundHelix](https://www.soundhelix.com/audio-examples) and are used for demonstration purposes only. Replace with your own audio files for production use.

## Notes

- Keep file sizes reasonable for better performance
- MP3 format is recommended for broad browser compatibility
- Consider adding metadata to your audio files for better display
