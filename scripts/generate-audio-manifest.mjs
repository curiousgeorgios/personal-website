/**
 * Build-time script to generate audio track manifest and extract artwork.
 *
 * Cloudflare Workers don't have filesystem access, so we pre-generate
 * track metadata and extract embedded artwork during the build.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseBuffer } from 'music-metadata';

const __dirname = dirname(fileURLToPath(import.meta.url));
const audioDir = join(__dirname, '..', 'public', 'audio');
const artworkDir = join(__dirname, '..', 'public', 'audio', 'artwork');
const outputPath = join(__dirname, '..', 'public', 'audio', 'manifest.json');

// Ensure artwork directory exists
if (!existsSync(artworkDir)) {
    mkdirSync(artworkDir, { recursive: true });
}

function getArtworkExtension(format) {
    if (format?.includes('jpeg') || format?.includes('jpg')) return 'jpg';
    if (format?.includes('png')) return 'png';
    if (format?.includes('gif')) return 'gif';
    if (format?.includes('webp')) return 'webp';
    return 'jpg'; // Default to jpg
}

async function generateManifest() {
    try {
        const files = readdirSync(audioDir);
        const mp3Files = files.filter(file => file.toLowerCase().endsWith('.mp3'));

        console.log(`Processing ${mp3Files.length} audio files...`);

        const tracks = await Promise.all(
            mp3Files.map(async (filename) => {
                const filePath = join(audioDir, filename);

                try {
                    const buffer = readFileSync(filePath);
                    const metadata = await parseBuffer(buffer, { mimeType: 'audio/mpeg' });

                    let title = metadata.common.title;
                    let artist = metadata.common.artist;

                    // Extract from filename if metadata is missing
                    if (!title || !artist) {
                        const filenameWithoutExt = filename.replace('.mp3', '');
                        if (filenameWithoutExt.includes(' - ')) {
                            const parts = filenameWithoutExt.split(' - ');
                            if (!artist) artist = parts[0].trim();
                            if (!title) title = parts.slice(1).join(' - ').trim();
                        } else {
                            if (!title) title = filenameWithoutExt;
                        }
                    }

                    title = title || filename.replace('.mp3', '');
                    artist = artist || 'Unknown Artist';

                    // Extract and save artwork if present
                    let artworkPath = null;
                    if (metadata.common.picture && metadata.common.picture.length > 0) {
                        const picture = metadata.common.picture[0];
                        const ext = getArtworkExtension(picture.format);
                        const artworkFilename = `${filename.replace('.mp3', '')}.${ext}`;
                        const artworkFullPath = join(artworkDir, artworkFilename);

                        writeFileSync(artworkFullPath, picture.data);
                        artworkPath = `/audio/artwork/${artworkFilename}`;
                        console.log(`  ✓ Extracted artwork for: ${filename}`);
                    }

                    return {
                        title,
                        artist,
                        src: `/audio/${filename}`,
                        artwork: artworkPath,
                        filename
                    };
                } catch (error) {
                    console.warn(`  ⚠ Could not parse metadata for ${filename}:`, error.message);

                    // Fallback to filename parsing
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
                        artwork: null,
                        filename
                    };
                }
            })
        );

        writeFileSync(outputPath, JSON.stringify(tracks, null, 2));
        console.log(`\n✓ Generated audio manifest with ${tracks.length} tracks`);
    } catch (error) {
        console.error('✗ Failed to generate audio manifest:', error.message);
        process.exit(1);
    }
}

generateManifest();
